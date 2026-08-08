let currentPath: string | null = null;

export function getCurrentFilePath(): string | null {
  return currentPath;
}

export function setCurrentFilePath(path: string | null): void {
  currentPath = path;
}
