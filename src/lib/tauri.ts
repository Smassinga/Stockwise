/**
 * Tauri API Integration for Stockwise
 * 
 * This file provides a wrapper around Tauri APIs for use in the Stockwise application.
 * It includes graceful fallbacks for when running in a web browser environment.
 */

// Check if we're running in a Tauri context
const isTauri = !!(window as any).__TAURI_IPC__;

/**
 * Open a path or URL using the system's default application
 * 
 * @param path - The path or URL to open
 * @returns Promise that resolves when the path has been opened
 */
export async function openPath(path: string): Promise<void> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-shell');
    return open(path);
  } else {
    // Fallback for web browsers
    window.open(path, '_blank');
    return Promise.resolve();
  }
}

/**
 * Show an open dialog to select files or directories
 * 
 * @param options - Dialog options
 * @returns Promise that resolves with the selected paths or null if cancelled
 */
export async function showOpenDialog(options?: {
  title?: string;
  directory?: boolean;
  multiple?: boolean;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string[] | string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    return open(options);
  } else {
    // Fallback for web browsers - this is a simplified version
    console.warn('Open dialog not available in web browser');
    return Promise.resolve(null);
  }
}

/**
 * Show a save dialog to select a file path
 * 
 * @param options - Dialog options
 * @returns Promise that resolves with the selected path or null if cancelled
 */
export async function showSaveDialog(options?: {
  title?: string;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    return save(options);
  } else {
    // Fallback for web browsers - this is a simplified version
    console.warn('Save dialog not available in web browser');
    return Promise.resolve(null);
  }
}

/**
 * Show a message dialog
 * 
 * @param message - The message to display
 * @param options - Dialog options
 * @returns Promise that resolves when the dialog is closed
 */
export async function showMessageDialog(
  message: string,
  options?: {
    title?: string;
    type?: 'info' | 'warning' | 'error';
  }
): Promise<void> {
  if (isTauri) {
    const { message: showMessage } = await import('@tauri-apps/plugin-dialog');
    await showMessage(message, options);
    return;
  } else {
    // Fallback for web browsers
    alert(message);
    return Promise.resolve();
  }
}

/**
 * Get the path to a special directory
 * 
 * @param dir - The directory name
 * @returns Promise that resolves with the path
 */
export async function getDirectoryPath(dir: 'appData' | 'localData' | 'home' | 'temp'): Promise<string> {
  if (isTauri) {
    switch (dir) {
      case 'appData':
        const { appDataDir } = await import('@tauri-apps/api/path');
        return appDataDir();
      case 'localData':
        const { localDataDir } = await import('@tauri-apps/api/path');
        return localDataDir();
      case 'home':
        const { homeDir } = await import('@tauri-apps/api/path');
        return homeDir();
      case 'temp':
        const { tempDir } = await import('@tauri-apps/api/path');
        return tempDir();
      default:
        throw new Error(`Unknown directory: ${dir}`);
    }
  } else {
    // Fallback for web browsers
    return Promise.resolve('/tmp'); // Simplified fallback
  }
}

/**
 * Read a file as text
 * 
 * @param path - The file path
 * @returns Promise that resolves with the file contents
 */
export async function readTextFile(path: string): Promise<string> {
  if (isTauri) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  } else {
    // Fallback for web browsers - this would require a different approach in practice
    throw new Error('Reading files not available in web browser');
  }
}

/**
 * Write text to a file
 * 
 * @param path - The file path
 * @param contents - The file contents
 * @returns Promise that resolves when the file is written
 */
export async function writeTextFile(path: string, contents: string): Promise<void> {
  if (isTauri) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    return writeTextFile(path, contents);
  } else {
    // Fallback for web browsers - this would require a different approach in practice
    throw new Error('Writing files not available in web browser');
  }
}

/**
 * Check if Tauri APIs are available
 * 
 * @returns boolean indicating if running in Tauri context
 */
export function isTauriContext(): boolean {
  return isTauri;
}

export default {
  openPath,
  showOpenDialog,
  showSaveDialog,
  showMessageDialog,
  getDirectoryPath,
  readTextFile,
  writeTextFile,
  isTauriContext
};