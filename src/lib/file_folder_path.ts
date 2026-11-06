/** Validate a relative folder path before trusting a native sync plan. */
export function isRelativeFolderPath(path: unknown): path is string {
  return typeof path === "string"
    && !path.startsWith("/") && !path.startsWith("\\")
    && !path.includes(":") && !path.includes("\0")
    && !path.replace(/\\/g, "/").split("/").includes("..")
    && (path === "" || path.replace(/\\/g, "/").split("/").some((part) => part !== "" && part !== "."));
}

/** Strip only an exact Canvas root; a different root is never an empty path. */
export function relativeFolderPath(fullName: string, root: string): string | undefined {
  const path = fullName === root ? "" : fullName.startsWith(`${root}/`) && fullName.length > root.length + 1 ? fullName.slice(root.length + 1) : undefined;
  return isRelativeFolderPath(path) ? path : undefined;
}
