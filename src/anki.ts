const ANKI_PORT: number = 8765;
import { AnkiConnectNote } from './interfaces/note-interface';

export interface AnkiConnectRequest {
	action: string;
	version: 6;
	params: any;
}

/**
 * AnkiConnect API interface module
 */

/**
 * Invoke AnkiConnect API with specified action and parameters
 */
export async function invoke(
	action: string,
	params: Record<string, any> = {},
): Promise<any> {
	const version = 6;
	const payload = { action, version, params };

	const response = await fetch('http://localhost:8765', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payload),
	});

	const responseJson = await response.json();

	if (responseJson.error) {
		throw new Error(`AnkiConnect error: ${responseJson.error}`);
	}

	return responseJson.result;
}

export function parse<T>(response: { error: string; result: T }): T {
	//Helper function for parsing the result of a multi
	if (Object.getOwnPropertyNames(response).length != 2) {
		throw 'response has an unexpected number of fields';
	}
	if (!response.hasOwnProperty('error')) {
		throw 'response is missing required error field';
	}
	if (!response.hasOwnProperty('result')) {
		throw 'response is missing required result field';
	}
	if (response.error) {
		throw response.error;
	}
	return response.result;
}

// All the rest of these functions only return request objects as opposed to actually carrying out the action. For efficiency!

function request(action: string, params = {}): AnkiConnectRequest {
	return { action, version: 6, params };
}

export function multi(actions: AnkiConnectRequest[]): AnkiConnectRequest {
	return request('multi', { actions: actions });
}

export function addNote(note: AnkiConnectNote): AnkiConnectRequest {
	return request('addNote', { note: note });
}

export function createDeck(deck: string): AnkiConnectRequest {
	return request('createDeck', { deck: deck });
}

export function deleteNotes(note_ids: number[]): AnkiConnectRequest {
	return request('deleteNotes', { notes: note_ids });
}

export function updateNoteFields(
	id: number,
	fields: Record<string, string>,
): AnkiConnectRequest {
	return request('updateNoteFields', {
		note: {
			id: id,
			fields: fields,
		},
	});
}

export function notesInfo(note_ids: number[]): AnkiConnectRequest {
	return request('notesInfo', {
		notes: note_ids,
	});
}

export function changeDeck(
	card_ids: number[],
	deck: string,
): AnkiConnectRequest {
	return request('changeDeck', {
		cards: card_ids,
		deck: deck,
	});
}

export function updateNoteTags(
	note_id: number,
	tags: string[],
): AnkiConnectRequest {
	return request('updateNoteTags', {
		note: note_id,
		tags: tags,
	});
}

export function getTags(): AnkiConnectRequest {
	return request('getTags');
}

export function storeMediaFile(
	filename: string,
	data: string,
): AnkiConnectRequest {
	return request('storeMediaFile', {
		filename: filename,
		data: data,
	});
}

export function storeMediaFileByPath(
	filename: string,
	path: string,
): AnkiConnectRequest {
	return request('storeMediaFile', {
		filename: filename,
		path: path,
	});
}
