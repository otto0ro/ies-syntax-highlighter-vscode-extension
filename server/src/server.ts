/* --------------------------------------------------------------------------------------------
 * Copyright (c) 2024 Telicent LTD. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * ------------------------------------------------------------------------------------------ */

import {
	createConnection, TextDocuments, ProposedFeatures, TextDocumentSyncKind,
	CompletionItemKind, CompletionParams, CompletionItem, Hover, Diagnostic, DiagnosticSeverity
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

const records = require('../src/records.json');

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);


let workspaceFolder: string | null;

documents.onDidOpen((event) => {
	validateTextDocument(event.document);
	connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Document opened: ${event.document.uri}`);
});
documents.listen(connection);

function validateTextDocument(textDocument) {
    const diagnostics = [];
    const lines = textDocument.getText().split(/\r?\n/g);
    let inStringLiteral = false;
    let inBracketBlock = false;
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        // check if line starts or ends a string literal
        if (line.includes('"')) {
            const quoteCount = (line.match(/"/g) || []).length;
            if (quoteCount % 2 !== 0) {
                inStringLiteral = !inStringLiteral;
            }
        }
        if (inStringLiteral) {
            continue;
        }
        if (line.startsWith('#')) {
            continue;
        }
        if (/^\s*$/.test(line)) {
            continue;
        }
        // track if inside a bracket block
        if (line.includes('[')) {
            inBracketBlock = true;
        }
        if (line.includes(']')) {
            inBracketBlock = false;
        }
        if (!(line.endsWith('.') || line.endsWith(',') || line.endsWith(';'))) {
            // allow line that starts a bracket block to be exempt
            if (!(inBracketBlock && line.endsWith('['))) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: { line: i, character: 0 },
                        end: { line: i, character: line.length }
                    },
                    message: `Lines end with a dot, comma, or semicolon`,
                    source: 'telicent-ies'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
    // Send the computed diagnostics to the LSP client.
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

function createCompletionItemFromRecord(key: string, value: string): CompletionItem {
    return {
        label: key,
        kind: CompletionItemKind.Text,
        detail: value,
        documentation: `This item represents a ${key}.`,
        insertText: key, 
    };
}

const documentsContent: Map<string, string> = new Map();

let dataToRecordMap: { [dataId: string]: string } = {};

documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
    documentsContent.set(change.document.uri, change.document.getText());
    const documentContent = change.document.getText();

    dataToRecordMap = {};
    const lines = documentContent.split(/\r?\n/g);
    for (const line of lines) {
        const match = line.match(/(data:\S+) a (\S+:\S+)/);  // adjust regex to match any namespace
        if (match) {
            const dataId = match[1];
            const recordType = match[2];
            dataToRecordMap[dataId] = recordType;
        }
    }
});
connection.onHover(
    ({ textDocument: { uri }, position }): Hover | null => {
        const documentContent = documentsContent.get(uri);

        if (documentContent) {
            const lines = documentContent.split(/\r?\n/g);
            const line = lines[position.line];

            // extract the word at the hover position
            const words = line.split(/\s+/);
            const word = words.find(w => line.indexOf(w) <= position.character && line.indexOf(w) + w.length >= position.character);

            if (!word) {
                return null;
            }

            // match triples of form 'data:instance a class'
            const tripleMatch = line.match(/(data:\S+)\s+a\s+(\S+:\S+)/);

            if (tripleMatch) {
                const dataId = tripleMatch[1];
                const className = tripleMatch[2];
                dataToRecordMap[dataId] = className; // Store the mapping
                
                if (word === className) {
                    // if the hovered word is the class name, show its definition
                    for (const record of records) {
                        if (record[className]) {
                            return {
                                contents: record[className]
                            };
                        }
                    }
                } else if (word === dataId) {
                    // if the hovered word is the instance, show the class it belongs to
                    return {
                        contents: `${className}`
                    };
                }
            } else {
                // check if the line contains a standalone instance
                const instanceMatch = line.match(/(data:\S+)\s*\.\s*$/);
                if (instanceMatch) {
                    const dataId = instanceMatch[1];
                    const className = dataToRecordMap[dataId];
                    if (className) {
                        return {
                            contents: `${className}`
                        };
                    }
                }

                // fallback to check if it's a class and show its definition
                for (const record of records) {
                    if (record[word]) {
                        return {
                            contents: record[word]
                        };
                    }
                }
            }
        }

        return null;
    }
);
connection.onCompletion((params: CompletionParams): CompletionItem[] => {
    const documentContent = documentsContent.get(params.textDocument.uri);

    if (documentContent) {
        const lines = documentContent.split(/\r?\n/g);
        const position = params.position;
        const line = lines[position.line];
        const completions: CompletionItem[] = [];

        for (const record of records) {
            for (const key in record) {
                const startString = key.charAt(0).toLowerCase();
                if (line.slice(0, position.character).toLowerCase().endsWith(startString)) {
                    const completionItem = createCompletionItemFromRecord(key, record[key]);
                    completions.push(completionItem);
                }
            }
        }
        // Returns all matching completions
        return completions;
    }

    return [];
});

connection.onCompletionResolve(
    (item: CompletionItem): CompletionItem => {
        if (item.data === 1) {
            item.detail = 'This is a custom completion item for the word Helloo.';
            item.documentation = 'When you start typing "Hel", this will suggest "Helloo".';
        }
        return item;
    }
);


connection.onInitialize((params) => {
    workspaceFolder = params.rootUri;
    connection.console.log(`[Server(${process.pid}) ${workspaceFolder}] Started and initialize received`);
    return {
        capabilities: {
            textDocumentSync: {
                openClose: true,
                change: TextDocumentSyncKind.Full
            },
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['i', 'I']
            },
			hoverProvider: true
        }
    };
});

connection.listen();