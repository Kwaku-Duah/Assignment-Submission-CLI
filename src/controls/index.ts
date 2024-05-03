#!/usr/bin/env node
import * as commander from "commander";
import { init } from "./init.js";
import { configure } from "./config.js";
import { snap } from "./snap.js";
import { submit } from "./submit.js";
import inquirer from "inquirer";

const program = new commander.Command();

program
  .command("init")
  .description("Initialize a directory as an assignment submission")
  .action(() => {
    init();
  });

program
  .command("config")
  .description("Configure the repository")
  .option("-i, --interactive", "Interactive mode")
  .option("--code <assignmentCode>", "Assignment code")
  .option("--student_id <studentId>", "Student ID")
  .action(async (options) => {
    const codeProvided = options.code !== undefined;
    const studentIdProvided = options.student_id !== undefined;

    if ((codeProvided && studentIdProvided) || options.interactive) {
      await configure(options);
    } else {
      console.log(
        "Please provide both options: --code and --student_id, or use interactive mode with -i."
      );
    }
  });

program
  .command("snap")
  .description("Create a snapshot of the working directory")
  .requiredOption("--name <snapshotName>", "Name of the snapshot")
  .action(async ({ name }) => {
    await snap(process.cwd(), name);
  });

program
  .command("submit")
  .description("Submit assignments")
  .option("-s, --snapshot <snapshot>", "Specify the snapshot name")
  .action(async (options) => {
    const { snapshot } = options;

    const { password } = await inquirer.prompt([
      {
        type: "password",
        name: "password",
        message: "Enter your password:",
        mask: "*",
      },
    ]);

    await submit(snapshot, password);
  });
  program.parse(process.argv);