import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

interface TreeObject {
  type: "tree" | "blob";
  name: string;
  hash: string;
  children?: TreeObject[];
}

interface TreeSnapshot {
  tree: TreeObject;
  files: {
    name: string;
    hash: string;
    type: "tree" | "blob";
  }[];
}

export function decompressSnapshot(snapshotFile: string): TreeSnapshot | null {
  try {
    // Check if the file is a regular file and ends with ".gz" extension
    const fileStats = fs.statSync(snapshotFile);
    if (!fileStats.isFile() || !snapshotFile.endsWith(".gz")) {
      return null;
    }

    const compressedSnapshot = fs.readFileSync(snapshotFile);
    const decompressedSnapshot = zlib.gunzipSync(compressedSnapshot);
    return JSON.parse(decompressedSnapshot.toString());
  } catch (error) {
    console.error(
      "Error decompressing or parsing snapshot file:",
      snapshotFile,
      error
    );
    return null;
  }
}

export function recreateTree(
  snapshot: TreeSnapshot,
  baseDir: string,
  snapName?: string
) {
  if (snapName === undefined) {
    const snapshotsFolder = path.join(baseDir, ".subsys", "snapshots");

    // Get a list of all snapshot files in the folder
    const snapshotFiles = fs.readdirSync(snapshotsFolder);

    // Iterate over each snapshot file and recreate the tree
    snapshotFiles.forEach((snapshotFile) => {
      const fullSnapshotPath = path.join(snapshotsFolder, snapshotFile);
      const snapshot = decompressSnapshot(fullSnapshotPath);
      if (snapshot !== null) {
        recreateTree(snapshot, baseDir, snapshotFile.replace(".json.gz", ""));
      }
    });
  } else {
    const tree = snapshot.tree;
    const treeObjects = snapshot.files;
    const directoryPath = path.join(
      baseDir,
      ".subsys",
      "snapshots",
      path.basename(snapName, path.extname(snapName)),
      tree.name
    );

    // Ensure the output directory exists, creating it if necessary
    fs.mkdirSync(directoryPath, { recursive: true });

    for (const fileObject of treeObjects) {
      const filePath = path.join(directoryPath, fileObject.name);
      const objectDir = path.join(baseDir, ".subsys", "objects");

      // Check if the fileObject is a file, not a directory
      if (fileObject.type === "blob") {
        if (fs.statSync(filePath).isFile()) {
          const objectFile = path.join(
            objectDir,
            fileObject.hash.slice(0, 2),
            fileObject.hash.slice(2)
          );

          if (fs.existsSync(objectFile)) {
            const fileContent = fs.readFileSync(objectFile);
            fs.writeFileSync(filePath, fileContent, "utf-8");
          } else {
            console.error(
              `Error recreating file '${filePath}': corresponding object file not found.`
            );
          }
        } else {
          console.error(
            `Error recreating file '${filePath}': it is not a file.`
          );
        }
      }
    }

    recreateTreeHelper(tree, directoryPath, baseDir);

    console.log(`Recreated tree '${tree.name}' successfully.`);
  }
}

function recreateTreeHelper(
  tree: TreeObject,
  parentPath: string,
  baseDir: string
) {
  for (const childObject of tree.children || []) {
    const childPath = path.join(parentPath, childObject.name);

    if (childObject.type === "tree") {
      // Recursively recreate the tree for subdirectories
      fs.mkdirSync(childPath, { recursive: true });
      recreateTreeHelper(childObject, childPath, baseDir);
    } else if (childObject.type === "blob") {
      const objectDir = path.join(baseDir, ".subsys", "objects");
      const objectFile = path.join(
        objectDir,
        childObject.hash.slice(0, 2),
        childObject.hash.slice(2)
      );

      if (fs.existsSync(objectFile)) {
        const fileContent = fs.readFileSync(objectFile);
        fs.writeFileSync(childPath, fileContent, "utf-8");
      } else {
        console.error(
          `Error recreating file '${childPath}': corresponding object file not found.`
        );
      }
    }
  }
}