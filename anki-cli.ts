#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as AnkiConnect from './src/anki';
import { SettingsManager } from './src/settings';
import { ParsedSettings } from './src/interfaces/settings-interface';
import { FileManager } from './src/files-manager';

// Import FileManager dynamically to avoid circular dependencies
// const { FileManager } = await import('./src/files-manager');

// Mock Obsidian's classes and functions
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

// Mock metadata cache, file manager, vault and app
class MockMetadataCache {
	getFileCache(file: MockTFile) {
		return { frontmatter: {}, tags: [] };
	}
}

class MockFileManager {
	generateMarkdownLink(file: MockTFile, sourcePath: string): string {
		return `[${file.name}](${file.path})`;
	}
}

class MockVault {
	getRoot() {
		return new MockTFolder(process.cwd());
	}

	getMarkdownFiles(): MockTFile[] {
		const markdownFiles: MockTFile[] = [];
		this.collectMarkdownFiles(process.cwd(), markdownFiles);
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

	async read(file: MockTFile): Promise<string> {
		return file.content;
	}
}

class MockApp {
	vault = new MockVault();
	metadataCache = new MockMetadataCache();
	fileManager = new MockFileManager();

	workspace = {
		getActiveFile: () => null,
		on: () => {},
		off: () => {},
		trigger: () => {},
	};
}

function log(message: string): void {
	console.log(`[Anki CLI] ${message}`);
}

class AnkiCLI {
	settingsManager: SettingsManager;
	app: MockApp;
	added_media: string[];
	file_hashes: Record<string, string>;
	dataPath: string;

	constructor() {
		this.app = new MockApp();
		this.dataPath = path.join(process.cwd(), '.anki-cli-data.json');
		this.settingsManager = new SettingsManager(
			path.join(process.cwd(), '.anki-cli-config.json'),
		);
		this.added_media = [];
		this.file_hashes = {};
	}

	async loadData(): Promise<void> {
		try {
			if (fs.existsSync(this.dataPath)) {
				const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
				this.added_media = data.added_media || [];
				this.file_hashes = data.file_hashes || {};
			}
		} catch (error) {
			log(`Error loading data: ${error.message}`);
			this.added_media = [];
			this.file_hashes = {};
		}
	}

	async saveData(): Promise<void> {
		fs.writeFileSync(
			this.dataPath,
			JSON.stringify(
				{
					added_media: this.added_media,
					file_hashes: this.file_hashes,
				},
				null,
				2,
			),
		);
	}

	async initializeAnkiConnection(): Promise<void> {
		log('Connecting to Anki...');
		try {
			// Get note types from Anki
			const note_types = await AnkiConnect.invoke('modelNames');
			this.settingsManager.note_types = note_types;

			// Generate fields dictionary for each note type
			for (const note_type of note_types) {
				const fields = await AnkiConnect.invoke('modelFieldNames', {
					modelName: note_type,
				});
				this.settingsManager.updateFieldsDict(note_type, fields);
			}

			// Regenerate any necessary regular expressions for note types
			this.settingsManager.regenerateSettingsRegexps();

			// Save settings
			await this.settingsManager.saveSettings();

			log('Successfully connected to Anki');
		} catch (error) {
			log(`Error connecting to Anki: ${error.message}`);
			throw error;
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
		try {
			await this.initializeAnkiConnection();
		} catch (error) {
			return;
		}

		// Get parsed settings
		const data: ParsedSettings = this.settingsManager.getParsedSettings();

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
		} else if (this.settingsManager.settings.Defaults['Scan Directory']) {
			const scanDir = this.settingsManager.settings.Defaults['Scan Directory'];
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

		// Create the file manager with our mocked app and parsed settings
		const manager = new FileManager(
			this.app as any,
			data,
			filesToScan as any[],
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

		log('All done! Saving data...');
		await this.saveData();
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
  --add-link         Add file link (true/false)
  --add-context      Add context (true/false)

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

		// Load settings and data
		await this.settingsManager.loadSettings();
		await this.loadData();

		let filePath: string | undefined;
		const cliArgs: Record<string, any> = {};

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];

			if (arg === '--scan-dir' && i + 1 < args.length) {
				cliArgs.scanDir = args[++i];
			} else if (arg === '--deck' && i + 1 < args.length) {
				cliArgs.deck = args[++i];
			} else if (arg === '--tag' && i + 1 < args.length) {
				cliArgs.tag = args[++i];
			} else if (arg === '--add-link' && i + 1 < args.length) {
				cliArgs['Add File Link'] = args[++i].toLowerCase() === 'true';
			} else if (arg === '--add-context' && i + 1 < args.length) {
				cliArgs['Add Context'] = args[++i].toLowerCase() === 'true';
			} else if (!arg.startsWith('-') && !filePath) {
				filePath = arg;
			}
		}

		// Update settings with CLI arguments
		this.settingsManager.updateFromArgs(cliArgs);

		// Save updated settings
		await this.settingsManager.saveSettings();

		// Scan files
		await this.scanFiles(filePath);
	}
}

// Execute the CLI
(async () => {
	const cli = new AnkiCLI();
	await cli.run();
})();
