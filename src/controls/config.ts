import * as fs from 'fs';
import * as path from 'path';
import inquirer, {  QuestionCollection } from 'inquirer';

interface Configuration {
    assignmentCode?: string;
    studentId?: string;
}

interface Options {
    code?: string;
    student_id?: string;
    interactive?: boolean;
}

export async function configure(options: Options, cwd = process.cwd()) {
    const subsysPath = path.join(cwd, '.subsys');
    const configFile = path.join(subsysPath, 'config.json');

    if (fs.existsSync(configFile)) {
        console.log('Repository already configured.');
        return;
    }

    if (!fs.existsSync(subsysPath)) {
        console.log("Repository is not initialized. Use 'subsys init' to initialize.");
        process.exit(1);
    }

    const codeProvided = options.code !== undefined;
    const studentIdProvided = options.student_id !== undefined;

    if ((codeProvided && studentIdProvided) || options.interactive) {
        try {
            const existingConfig = loadConfiguration();

            if (isConfigPopulated(existingConfig) && !options.interactive) {
                console.log('Configuration already exists and is populated. Use interactive mode to reconfigure.');
                process.exit(1);
            }

            const promptAnswers = options.interactive ? await promptForMissingInfo(existingConfig) : options;

            saveConfiguration(promptAnswers.code, promptAnswers.student_id);
        } catch (error) {
            console.error('Error configuring repository:', (error as Error).message);
            process.exit(1);
        }
    } else {
        console.log('Please provide both options: --code and --student_id.');
    }

    function loadConfiguration(): Configuration {
        try {
            const configData = fs.readFileSync(configFile, 'utf-8');
            return JSON.parse(configData);
        } catch (error) {
            return {};
        }
    }

    function isConfigPopulated(config: Configuration): boolean {
        return !!config.assignmentCode && !!config.studentId;
    }

    async function promptForMissingInfo(existingConfig: Configuration): Promise<Options> {
        const prompts: QuestionCollection[] = [];

        if (!existingConfig.assignmentCode) {
            prompts.push({
                type: 'input',
                name: 'code',
                message: 'Enter your assignment code:',
                validate: (input: string) => !!input.trim(),
            });
        }

        if (!existingConfig.studentId) {
            prompts.push({
                type: 'input',
                name: 'student_id',
                message: 'Enter your student ID:',
                validate: (input: string) => !!input.trim(),
            });
        }

        return inquirer.prompt(prompts) as Promise<Options>;
    }

    function saveConfiguration(assignmentCode: string | undefined, studentId: string | undefined) {
        const configData: Configuration = {
            studentId,
            assignmentCode,
        };

        fs.mkdirSync(subsysPath, { recursive: true });

        fs.writeFileSync(configFile, JSON.stringify(configData, null, 2));

        console.log('Repository configured successfully.');
    }
}
