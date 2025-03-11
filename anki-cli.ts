#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as AnkiConnect from './src/anki';
import {
	PluginSettings,
	ParsedSettings,
} from './src/interfaces/settings-interface';
import { DEFAULT_IGNORED_FILE_GLOBS } from './src/settings';
import { settingToData } from './src/setting-to-data';
import { FileManager } from './src/files-manager';

// Mock Obsidian's classes and functions that we need
class MockTFile {
	path: string;
	name: string;
	extension: string;
	content: string;

	constructor(filePath: string) {
		this.path = filePath;
		this.name = path.basename(filePath);
		this.extension = path.extname(filePath).substring(1);
		this.content = fs.readFileSync(filePath, 'utf8');
	}
}

class MockTFolder {
	path: string;
	name: string;
	children: Array<MockTFile | MockTFolder>;

	constructor(folderPath: string) {
		this.path = folderPath;
		this.name = path.basename(folderPath);
		this.children = [];

		const items = fs.readdirSync(folderPath);
		for (const item of items) {
			const itemPath = path.join(folderPath, item);
			const stats = fs.statSync(itemPath);

			if (stats.isDirectory()) {
				this.children.push(new MockTFolder(itemPath));
			} else if (stats.isFile() && path.extname(item) === '.md') {
				this.children.push(new MockTFile(itemPath));
			}
		}
	}
}

// Create a metadata cache mock
class MockMetadataCache {
	getFileCache(file: MockTFile) {
		return {
			frontmatter: {},
			tags: [],
		};
	}
}

// Create a file manager mock
class MockFileManager {
	generateMarkdownLink(file: MockTFile, sourcePath: string): string {
		return `[${file.name}](${file.path})`;
	}
}

class MockVault {
	getMarkdownFiles(): MockTFile[] {
		const markdownFiles: MockTFile[] = [];
		const scanDir = process.cwd();
		this.collectMarkdownFiles(scanDir, markdownFiles);
		return markdownFiles;
	}

	private collectMarkdownFiles(dir: string, files: MockTFile[]): void {
		const items = fs.readdirSync(dir);
		for (const item of items) {
			const fullPath = path.join(dir, item);
			const stats = fs.statSync(fullPath);

			if (stats.isDirectory()) {
				this.collectMarkdownFiles(fullPath, files);
			} else if (stats.isFile() && path.extname(item) === '.md') {
				files.push(new MockTFile(fullPath));
			}
		}
	}

	getAbstractFileByPath(filePath: string): MockTFile | MockTFolder | null {
		try {
			const stats = fs.statSync(filePath);
			if (stats.isDirectory()) {
				return new MockTFolder(filePath);
			} else if (stats.isFile()) {
				return new MockTFile(filePath);
			}
		} catch (error) {
			return null;
		}
		return null;
	}

	// Add additional methods that might be needed
	read(file: MockTFile): Promise<string> {
		return Promise.resolve(file.content);
	}
}

// Create a mock of the Obsidian App interface
class MockApp {
	vault = new MockVault();
	metadataCache = new MockMetadataCache();
	fileManager = new MockFileManager();

	// Mock additional required properties
	keymap = {};
	scope = {};
	lastEvent = null;

	workspace = {
		getActiveFile: () => null,
		on: () => {},
		off: () => {},
		trigger: () => {},
	};
}

// Create a type assertion to make TypeScript accept our mock
// Modify the settingToData import to work with our mock
// You'll need to create this file or modify the existing one
const mockSettingToData = async (
	app: MockApp,
	settings: PluginSettings,
	fields_dict: Record<string, string[]>,
): Promise<ParsedSettings> => {
	// This is a simplified version - you'll need to implement the actual functionality
	// or modify the original settingToData to accept our mock
	// @ts-expect-error
	return {
		// Fill in the required fields based on your ParsedSettings interface
		file_link_fields: settings.FILE_LINK_FIELDS,
		context_fields: settings.CONTEXT_FIELDS,
		custom_regexps: settings.CUSTOM_REGEXPS,
		folder_decks: settings.FOLDER_DECKS,
		folder_tags: settings.FOLDER_TAGS,
		add_file_link: settings.Defaults['Add File Link'],
		add_context: settings.Defaults['Add Context'],
		file_link_fields_set: new Set(Object.values(settings.FILE_LINK_FIELDS)),
		context_fields_set: new Set(Object.values(settings.CONTEXT_FIELDS)),
		default_deck: settings.Defaults['Deck'],
		default_tag: settings.Defaults['Tag'],
		id_regexp: new RegExp('^.+$'), // This is a simplified version
		fields_dict: fields_dict,
		// Add any other required fields
	} as ParsedSettings;
};

function log(message: string): void {
	console.log(`[Anki CLI] ${message}`);
}

const DEFAULT_SETTINGS: PluginSettings = {
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
		'Prepend File Link Line Break': false,
		'Add Context': false,
		CurlyCloze: false,
		'CurlyCloze - Highlights to Clozes': false,
		'ID Comments': true,
		'Add Obsidian Tags': false,
	},
	IGNORED_FILE_GLOBS: DEFAULT_IGNORED_FILE_GLOBS,
};

class AnkiCLI {
	settings: PluginSettings;
	note_types: Array<string>;
	fields_dict: Record<string, string[]>;
	added_media: string[];
	file_hashes: Record<string, string>;
	app: MockApp;
	configPath: string;

	constructor() {
		this.app = new MockApp();
		this.configPath = path.join(process.cwd(), '.anki-cli-config.json');
		this.added_media = [];
		this.file_hashes = {};
		this.fields_dict = {};
	}

	async getDefaultSettings(): Promise<PluginSettings> {
		let settings: PluginSettings = DEFAULT_SETTINGS;
		/*Making settings from scratch, so need note types*/
		this.note_types = (await AnkiConnect.invoke('modelNames')) as Array<string>;
		this.fields_dict = await this.generateFieldsDict();
		for (let note_type of this.note_types) {
			settings['CUSTOM_REGEXPS'][note_type] = '';
			const field_names: string[] = (await AnkiConnect.invoke(
				'modelFieldNames',
				{ modelName: note_type },
			)) as string[];
			this.fields_dict[note_type] = field_names;
			settings['FILE_LINK_FIELDS'][note_type] = field_names[0];
		}
		return settings;
	}

	async generateFieldsDict(): Promise<Record<string, string[]>> {
		let fields_dict = {};
		for (let note_type of this.note_types) {
			const field_names: string[] = (await AnkiConnect.invoke(
				'modelFieldNames',
				{ modelName: note_type },
			)) as string[];
			fields_dict[note_type] = field_names;
		}
		return fields_dict;
	}

	async saveConfig(): Promise<void> {
		fs.writeFileSync(
			this.configPath,
			JSON.stringify(
				{
					settings: this.settings,
					'Added Media': this.added_media,
					'File Hashes': this.file_hashes,
					fields_dict: this.fields_dict,
				},
				null,
				2,
			),
		);
	}

	async loadConfig(): Promise<void> {
		try {
			if (fs.existsSync(this.configPath)) {
				const data = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
				this.settings = this.mergeSettings(
					structuredClone(DEFAULT_SETTINGS),
					data.settings,
				);
				this.added_media = data['Added Media'] || [];
				this.file_hashes = data['File Hashes'] || {};
				this.fields_dict = data.fields_dict || {};
			} else {
				log('No config file found. Creating default settings...');
				await this.initializeDefaultConfig();
			}
		} catch (error) {
			log(`Error loading config: ${error.message}`);
			await this.initializeDefaultConfig();
		}
	}

	async initializeDefaultConfig(): Promise<void> {
		log('Connecting to Anki to generate default settings...');
		try {
			this.settings = await this.getDefaultSettings();
			this.saveConfig();
			log('Default settings successfully generated!');
		} catch (error) {
			log(`Error connecting to Anki: ${error.message}`);
			process.exit(1);
		}
	}

	mergeSettings(def_setting: any, data_setting: any): PluginSettings {
		if (Object(data_setting) !== data_setting) return data_setting;
		if (Object(def_setting) !== def_setting) def_setting = {};
		for (let key in data_setting) {
			def_setting[key] = this.mergeSettings(
				def_setting[key],
				data_setting[key],
			);
		}
		return def_setting;
	}

	regenerateSettingsRegexps() {
		let regexp_section = this.settings['CUSTOM_REGEXPS'];
		// For new note types
		for (let note_type of this.note_types) {
			this.settings['CUSTOM_REGEXPS'][note_type] =
				regexp_section.hasOwnProperty(note_type) ?
					regexp_section[note_type]
				:	'';
		}
		// Removing old note types
		for (let note_type of Object.keys(this.settings['CUSTOM_REGEXPS'])) {
			if (!this.note_types.includes(note_type)) {
				delete this.settings['CUSTOM_REGEXPS'][note_type];
			}
		}
	}

	getAllFilesInFolder(folderPath: string): MockTFile[] {
		const allFiles: MockTFile[] = [];

		function traverseFolder(dir: string) {
			const items = fs.readdirSync(dir);
			for (const item of items) {
				const fullPath = path.join(dir, item);
				const stats = fs.statSync(fullPath);

				if (stats.isDirectory()) {
					traverseFolder(fullPath);
				} else if (stats.isFile() && path.extname(item) === '.md') {
					allFiles.push(new MockTFile(fullPath));
				}
			}
		}

		traverseFolder(folderPath);
		return allFiles;
	}

	async scanFiles(filePath?: string) {
		log('Checking connection to Anki...');
		try {
			await AnkiConnect.invoke('modelNames');
		} catch (e) {
			log(`Error connecting to Anki: ${e.message}`);
			return;
		}
		log('Successfully connected to Anki!');

		// Use our mock version or add a type assertion to make it work
		const data: ParsedSettings = await mockSettingToData(
			this.app,
			this.settings,
			this.fields_dict,
		);

		let filesToScan: MockTFile[] = [];

		if (filePath) {
			log(`Scanning specific file: ${filePath}`);
			if (fs.existsSync(filePath)) {
				if (
					fs.statSync(filePath).isFile() &&
					path.extname(filePath) === '.md'
				) {
					filesToScan = [new MockTFile(filePath)];
				} else {
					log('Error: Specified path is not a markdown file');
					return;
				}
			} else {
				log(`Error: File not found: ${filePath}`);
				return;
			}
		} else if (this.settings.Defaults['Scan Directory']) {
			const scanDir = this.settings.Defaults['Scan Directory'];
			log(`Using scan directory: ${scanDir}`);
			if (fs.existsSync(scanDir) && fs.statSync(scanDir).isDirectory()) {
				filesToScan = this.getAllFilesInFolder(scanDir);
			} else {
				log(`Error: Invalid scan directory: ${scanDir}`);
				return;
			}
		} else {
			log('Scanning all markdown files in current directory');
			filesToScan = this.app.vault.getMarkdownFiles();
		}

		log(`Found ${filesToScan.length} files to scan`);

		// Use type assertion to satisfy TypeScript
		const manager = new FileManager(
			this.app as any, // Type assertion to bypass type checking
			data,
			filesToScan as any[], // Type assertion
			this.file_hashes,
			this.added_media,
		);

		log('Initializing files...');
		await manager.initialiseFiles();
		log('Processing notes...');
		await manager.requests_1();

		this.added_media = Array.from(manager.added_media_set);
		const hashes = manager.getHashes();
		for (let key in hashes) {
			this.file_hashes[key] = hashes[key];
		}

		log('All done! Saving configuration...');
		await this.saveConfig();
	}

	printHelp(): void {
		console.log(`
Anki CLI - Send notes from markdown files to Anki

Usage:
  node anki-cli.js [options] [file]

Options:
  --help, -h         Show this help
  --scan-dir <path>  Set scan directory
  --deck <name>      Set default deck
  --tag <tag>        Set default tag

Examples:
  node anki-cli.js                    # Scan all markdown files in current directory
  node anki-cli.js notes.md           # Scan a specific file
  node anki-cli.js --scan-dir ./notes # Set scan directory and scan all files in it
  node anki-cli.js --deck MyDeck      # Use "MyDeck" as the default deck
`);
	}

	async run(): Promise<void> {
		const args = process.argv.slice(2);

		if (args.includes('--help') || args.includes('-h')) {
			this.printHelp();
			return;
		}

		await this.loadConfig();

		let filePath: string | undefined;

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];

			if (arg === '--scan-dir' && i + 1 < args.length) {
				this.settings.Defaults['Scan Directory'] = args[++i];
			} else if (arg === '--deck' && i + 1 < args.length) {
				this.settings.Defaults['Deck'] = args[++i];
			} else if (arg === '--tag' && i + 1 < args.length) {
				this.settings.Defaults['Tag'] = args[++i];
			} else if (!arg.startsWith('-') && !filePath) {
				filePath = arg;
			}
		}

		await this.scanFiles(filePath);
	}
}

// Execute the CLI
(async () => {
	const cli = new AnkiCLI();
	await cli.run();
})();
