import * as fs from 'fs';
import * as path from 'path';

export const DEFAULT_IGNORED_FILE_GLOBS = ['**/*.excalidraw.md'];

const defaultDescs = {
	'Scan Directory':
		'The directory to scan. Leave empty to scan the entire current directory',
	Tag: 'The tag that the plugin automatically adds to any generated cards.',
	Deck: 'The deck the plugin adds cards to if TARGET DECK is not specified in the file.',
	'Scheduling Interval':
		'The time, in minutes, between automatic scans. Set this to 0 to disable automatic scanning.',
	'Add File Link':
		'Append a link to the file that generated the flashcard on the field specified in the table.',
	'Prepend File Link Line Break':
		'Prepends a line break to the File Link field.',
	'Add Context':
		"Append 'context' for the card, in the form of path > heading > heading etc, to the field specified in the table.",
	CurlyCloze:
		"Convert {cloze deletions} -> {{c1::cloze deletions}} on note types that have a 'Cloze' in their name.",
	'CurlyCloze - Highlights to Clozes':
		'Convert ==highlights== -> {highlights} to be processed by CurlyCloze.',
	'ID Comments': 'Wrap note IDs in a HTML comment.',
	'Add Obsidian Tags':
		'Interpret #tags in the fields of a note as Anki tags, removing them from the note text in Anki.',
};

export const DEFAULT_SETTINGS = {
	CUSTOM_REGEXPS: {},
	FILE_LINK_FIELDS: {},
	CONTEXT_FIELDS: {},
	FOLDER_DECKS: {},
	FOLDER_TAGS: {},
	Syntax: {
		'Begin Note': 'START',
		'End Note': 'END',
		'Begin Inline Note': 'STARTI',
		'End Inline Note': 'ENDI',
		'Target Deck Line': 'TARGET DECK',
		'File Tags Line': 'FILE TAGS',
		'Delete Note Line': 'DELETE',
		'Frozen Fields Line': 'FROZEN',
	},
	Defaults: {
		'Scan Directory': '',
		Tag: 'Obsidian_to_Anki',
		Deck: 'Default',
		'Scheduling Interval': 0,
		'Add File Link': false,
		'Prepend File Link Line Break': true,
		'Add Context': false,
		CurlyCloze: false,
		'CurlyCloze - Highlights to Clozes': false,
		'ID Comments': true,
		'Add Obsidian Tags': false,
	},
	IGNORED_FILE_GLOBS: DEFAULT_IGNORED_FILE_GLOBS,
};

export class SettingsManager {
	settings: any;
	fields_dict: Record<string, string[]>;
	note_types: string[];
	configPath: string;

	constructor(configPath: string = '.anki-cli-config.json') {
		this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		this.fields_dict = {};
		this.note_types = [];
		this.configPath = configPath;
	}

	async loadSettings(): Promise<void> {
		try {
			if (fs.existsSync(this.configPath)) {
				const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
				if (data.settings) {
					this.settings = this.mergeSettings(
						JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
						data.settings,
					);
				}
				if (data.fields_dict) {
					this.fields_dict = data.fields_dict;
				}
			} else {
				console.log('No settings file found. Using defaults.');
			}
		} catch (error) {
			console.error(`Error loading settings: ${error.message}`);
			this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		}
	}

	async saveSettings(): Promise<void> {
		try {
			fs.writeFileSync(
				this.configPath,
				JSON.stringify(
					{
						settings: this.settings,
						fields_dict: this.fields_dict,
					},
					null,
					2,
				),
			);
		} catch (error) {
			console.error(`Error saving settings: ${error.message}`);
		}
	}

	mergeSettings(defaultSettings: any, userSettings: any): any {
		if (Object(userSettings) !== userSettings) return userSettings;
		if (Object(defaultSettings) !== defaultSettings) defaultSettings = {};

		for (let key in userSettings) {
			defaultSettings[key] = this.mergeSettings(
				defaultSettings[key],
				userSettings[key],
			);
		}
		return defaultSettings;
	}

	regenerateSettingsRegexps(): void {
		let regexp_section = this.settings.CUSTOM_REGEXPS;

		// For new note types
		for (let note_type of this.note_types) {
			this.settings.CUSTOM_REGEXPS[note_type] =
				regexp_section.hasOwnProperty(note_type) ?
					regexp_section[note_type]
				:	'';
		}

		// Removing old note types
		for (let note_type of Object.keys(this.settings.CUSTOM_REGEXPS)) {
			if (!this.note_types.includes(note_type)) {
				delete this.settings.CUSTOM_REGEXPS[note_type];
			}
		}
	}

	updateFieldsDict(note_type: string, fields: string[]): void {
		this.fields_dict[note_type] = fields;

		// If this is a new note type, initialize its FILE_LINK_FIELDS with the first field
		if (!this.settings.FILE_LINK_FIELDS[note_type] && fields.length > 0) {
			this.settings.FILE_LINK_FIELDS[note_type] = fields[0];
		}

		// Initialize CONTEXT_FIELDS if needed
		if (!this.settings.CONTEXT_FIELDS[note_type] && fields.length > 0) {
			this.settings.CONTEXT_FIELDS[note_type] = fields[0];
		}
	}

	getAllSettings(): any {
		return {
			settings: this.settings,
			fields_dict: this.fields_dict,
			note_types: this.note_types,
		};
	}

	// Method to update settings from CLI arguments
	updateFromArgs(args: Record<string, any>): void {
		for (const key in args) {
			if (key === 'scanDir' && args[key]) {
				this.settings.Defaults['Scan Directory'] = args[key];
			} else if (key === 'deck' && args[key]) {
				this.settings.Defaults['Deck'] = args[key];
			} else if (key === 'tag' && args[key]) {
				this.settings.Defaults['Tag'] = args[key];
			} else if (key in this.settings.Defaults) {
				// For other settings like 'Add File Link', 'Add Context', etc.
				this.settings.Defaults[key] = args[key];
			}
		}
	}

	// Method to get a parsed version of settings for use in the application
	getParsedSettings(): any {
		return {
			file_link_fields: this.settings.FILE_LINK_FIELDS,
			context_fields: this.settings.CONTEXT_FIELDS,
			custom_regexps: this.settings.CUSTOM_REGEXPS,
			folder_decks: this.settings.FOLDER_DECKS,
			folder_tags: this.settings.FOLDER_TAGS,
			add_file_link: this.settings.Defaults['Add File Link'],
			add_context: this.settings.Defaults['Add Context'],
			file_link_fields_set: new Set(
				Object.values(this.settings.FILE_LINK_FIELDS),
			),
			context_fields_set: new Set(Object.values(this.settings.CONTEXT_FIELDS)),
			default_deck: this.settings.Defaults['Deck'],
			default_tag: this.settings.Defaults['Tag'],
			id_regexp: new RegExp('^.+$'), // Simplified version
			fields_dict: this.fields_dict,
			syntax: this.settings.Syntax,
			curly_cloze: this.settings.Defaults['CurlyCloze'],
			highlights_to_clozes:
				this.settings.Defaults['CurlyCloze - Highlights to Clozes'],
			id_comments: this.settings.Defaults['ID Comments'],
			add_obsidian_tags: this.settings.Defaults['Add Obsidian Tags'],
			ignored_file_globs: this.settings.IGNORED_FILE_GLOBS,
		};
	}
}
