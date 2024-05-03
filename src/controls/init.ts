import * as fs from "fs";
import * as path from "path";

export function init(cwd = process.cwd()) {
  const subsysPath = path.join(cwd, ".subsys");

  try {
    fs.accessSync(subsysPath);

    console.log("Reinitialized existing assignment repository.");
    process.exit(0);
  } catch (error) {
    fs.mkdirSync(subsysPath, { recursive: true });
    fs.mkdirSync(path.join(subsysPath, "objects"));

    // Create files - HEAD
    fs.writeFileSync(path.join(subsysPath, "HEAD"), "ref: refs/heads/master");
    console.log("Initialized empty assignment repository in " + subsysPath);
  }
}