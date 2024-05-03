import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { promisify } from "util";
import * as glob from "glob";

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

interface TreeObject {
  type: "tree" | "blob";
  name: string;
  hash: string;
  children?: TreeObject[];
}

async function isDuplicateName(
  snapshotDir: string,
  name: string
): Promise<boolean> {
  const logTrackPath = path.join(snapshotDir, "logTrack.json");

  try {
    if (fs.existsSync(logTrackPath)) {
      const logTrackContent = fs.readFileSync(logTrackPath, "utf-8");
      const logTrack = JSON.parse(logTrackContent);

      return logTrack.some(
        (entry: { treeName: string }) => entry.treeName === name
      );
    }

    return false;
  } catch (error) {
    console.error("Error checking for duplicate name:", error);
    return true;
  }
}

async function isDuplicateSHA(
  snapshotDir: string,
  currentHash: string
): Promise<boolean> {
  const logTrackPath = path.join(snapshotDir, "logTrack.json");

  try {
    if (fs.existsSync(logTrackPath)) {
      const logTrackContent = fs.readFileSync(logTrackPath, "utf-8");
      const logTrack = JSON.parse(logTrackContent);


      const isUpToDate = logTrack.some(
        (entry: { SHA: string }) => entry.SHA === currentHash
      );
      if (isUpToDate) {
        console.log("Everything is up to date.");
      }

      return isUpToDate;
    }

    return false;
  } catch (error) {
    console.error("Error checking for duplicate SHA:", error);
    return true; // Treat error as duplicate to prevent unintended behavior
  }
}

export async function snap(cwd: string, snapshotName: string) {
  const sanitizedSnapshotName = snapshotName
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();

  if (sanitizedSnapshotName !== snapshotName) {
    console.error(
      "Snapshot name contains invalid characters. Please use a slug."
    );
    return;
  }

  const subsysDir = path.join(cwd, ".subsys");
  const snapshotDir = path.join(subsysDir, "snapshots");
  const objectsDir = path.join(subsysDir, "objects");

  if (!fs.existsSync(snapshotDir)) {
    fs.mkdirSync(snapshotDir, { recursive: true });
  }

  if (!fs.existsSync(objectsDir)) {
    fs.mkdirSync(objectsDir, { recursive: true });
  }

  const ignoreList = await getIgnoreList(cwd);

  const treeObject = await calculateTreeHash(cwd, ignoreList);

  async function calculateFileHash(filePath: string): Promise<string> {
    const fileContent = await fs.promises.readFile(filePath);
    const hash = crypto.createHash("sha1");
    hash.update(fileContent);
    return hash.digest("hex");
  }

  async function calculateTreeHash(
    directoryPath: string,
    ignoreList: Set<string>
  ): Promise<TreeObject> {
    const entries = await readdir(directoryPath);

    const treeObject: TreeObject = {
      type: "tree",
      name: "",
      hash: "",
      children: [],
    };

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry);
      const isDirectory = await stat(entryPath);

      if (
        entry === ".subsys" ||
        entry === "node_modules" ||
        entry === "config.json" ||
        ignoreList.has(entry)
      ) {
        continue;
      }

      const childObject: TreeObject = {
        type: isDirectory.isDirectory() ? "tree" : "blob",
        name: entry,
        hash: isDirectory.isDirectory()
          ? (await calculateTreeHash(entryPath, ignoreList)).hash
          : await calculateFileHash(entryPath),
      };

      if (isDirectory.isDirectory()) {
        // Recursively calculate tree hash for subdirectories
        const subTreeObject = await calculateTreeHash(entryPath, ignoreList);
        childObject.children = subTreeObject.children;
      }

      treeObject.children!.push(childObject);
    }

    treeObject.children!.sort((a, b) => a.name.localeCompare(b.name));

    // Concatenate and hash the serialized tree objects
    const serializedTree = treeObject
      .children!.map((obj) => `${obj.type} ${obj.name}\0${obj.hash}`)
      .join("");
    const hash = crypto.createHash("sha1");
    hash.update(serializedTree);

    treeObject.hash = hash.digest("hex");

    return treeObject;
  }

  // Check if snapshot with the same name already exists
  if (await isDuplicateName(snapshotDir, sanitizedSnapshotName)) {
    console.error("Snapshot with the same name already exists.");
    return;
  }

  // Check if snapshot with the same tree hash already exists
  if (await isDuplicateSHA(snapshotDir, treeObject.hash)) {
    console.error("Snapshot with the same content already exists.");
    return;
  }

  const snapshotData: {
    tree: TreeObject;
    files: { name: string; hash: string }[];
  } = {
    tree: treeObject,
    files: [],
  };

  const snapshotFile = path.join(snapshotDir, sanitizedSnapshotName + ".gz");

  try {
    const serializedSnapshot = JSON.stringify(snapshotData);
    const compressedSnapshot = zlib.gzipSync(Buffer.from(serializedSnapshot));
    fs.writeFileSync(snapshotFile, compressedSnapshot);

    // Update logTrack.json
    const logTrackPath = path.join(snapshotDir, "logTrack.json");
    const logTrack = fs.existsSync(logTrackPath)
      ? JSON.parse(fs.readFileSync(logTrackPath, "utf-8"))
      : [];

    logTrack.push({
      treeName: snapshotName,
      SHA: treeObject.hash,
    });

    fs.writeFileSync(logTrackPath, JSON.stringify(logTrack, null, 2));

  } catch (error: unknown) {
    console.error(`Error creating snapshot file '${snapshotFile}':`, error);
    return;
  }

  async function getIgnoreList(cwd: string): Promise<Set<string>> {
    const subsysIgnorePath = path.join(cwd, ".subsysignore");
    const ignoreList = new Set<string>();

    try {
      if (fs.existsSync(subsysIgnorePath)) {
        const ignoreContent = await fs.promises.readFile(
          subsysIgnorePath,
          "utf-8"
        );
        const lines = ignoreContent.split("\n");

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (trimmedLine !== "") {
            // Check if the line contains a glob pattern
            if (trimmedLine.includes("*")) {
              // Use glob to expand the pattern and add all matching files/directories
              const matchingFiles = glob.sync(trimmedLine, { cwd });
              matchingFiles.forEach((match) => ignoreList.add(match));
            } else {
              ignoreList.add(trimmedLine);
            }
          }
        }
      }
    } catch (error: unknown) {
      throw new Error("Error");
    }

    return ignoreList;
  }

  async function processEntry(
    entryPath: string,
    baseDir: string,
    objectsDir: string,
    treeObjects: TreeObject[],
    snapshotData: {
      tree: TreeObject;
      files: { name: string; hash: string }[];
    }
  ) {
    const isFile = await stat(entryPath);
    const relativePath = path.relative(baseDir, entryPath);

    if (isFile.isFile()) {
      const fileHash = await calculateFileHash(entryPath);

      // Store the file in the objects directory
      const objectFile = path.join(
        objectsDir,
        fileHash.substring(0, 2),
        fileHash.slice(2)
      );
      if (!fs.existsSync(path.dirname(objectFile))) {
        fs.mkdirSync(path.dirname(objectFile), { recursive: true });
      }
      const fileContent = fs.readFileSync(entryPath);
      fs.writeFileSync(objectFile, fileContent);

      treeObjects.push({
        type: "blob",
        name: relativePath,
        hash: fileHash,
      });

      snapshotData.files.push({
        name: relativePath,
        hash: fileHash,
      });
    } else {
      // It's a directory, so process its contents recursively
      const entries = await readdir(entryPath);
      const subTreeObjects: TreeObject[] = [];

      for (const subEntry of entries) {
        const subEntryPath = path.join(entryPath, subEntry);
        await processEntry(
          subEntryPath,
          baseDir,
          objectsDir,
          subTreeObjects,
          snapshotData
        );
      }

      treeObjects.push({
        type: "tree",
        name: relativePath,
        hash: "",
        children: subTreeObjects,
      });
    }
  }

  // Process the root directory
  await processEntry(cwd, "", objectsDir, treeObject.children!, snapshotData);

  // Update the root directory hash in treeObject
  const serializedTree = treeObject
    .children!.map((obj) => `${obj.type} ${obj.name}\0${obj.hash}`)
    .join("");
  const hash = crypto.createHash("sha1");
  hash.update(serializedTree);
  treeObject.hash = hash.digest("hex");

  console.log(`Snapshot '${sanitizedSnapshotName}' created successfully.`);
}
