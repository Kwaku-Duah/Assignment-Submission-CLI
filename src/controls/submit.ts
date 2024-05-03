import axios, { AxiosError } from "axios";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { decompressSnapshot, recreateTree } from "../utils/recursive.js";

dotenv.config();

interface AuthenticationResponse {
  success: boolean;
  token?: string;
  message?: string;
  user?: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    staffId: string;
    role: string;
    changePassword: boolean;
  };
}

interface ConfigData {
  studentId: string;
  assignmentCode: string;
}

interface Assignment {
  id: number;
  title: string;
  course: string;
  description: string;
  deadline: string;
  lecturerId: string;
  isPublished: boolean;
  assignmentCode: string;
}

export async function submit(
  snapshotName: string | undefined,
  password: string
): Promise<void> {
  try {
    // Read the saved studentId and assignmentCode from the configuration
    const subsysPath = ".subsys";
    const configFile = path.join(subsysPath, "config.json");
    if (!fs.existsSync(configFile)) {
      console.error("Configuration not found. Configure the repository first.");
      return;
    }

    const configContent = fs.readFileSync(configFile, "utf-8");
    const configData: ConfigData = JSON.parse(configContent);
    const { studentId, assignmentCode } = configData;

    const backendUrl = process.env.BACKEND_URL || "https://asp-feb-backend.amalitech-dev.net";
    const loginUrl = `${backendUrl}/api/auth/login`;
    const emailOrId = studentId;

    const headers = {
      "Content-Type": "application/json",
    };

    const authenticate = async () => {
      try {
        // Making the authentication request
        const response = await axios.post<AuthenticationResponse>(
          loginUrl,
          { emailOrId, password },
          { headers }
        );

        if (response.status === 200) {
          console.log("Authentication is a success");
          const authToken = response.data.token;

          await checkAssignmentAndDeadline(
            backendUrl,
            assignmentCode,
            authToken,
            snapshotName
          );
        } else {
          console.error("Authentication failed. Please try again.");
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError<AuthenticationResponse>;
          console.error(
            "Error during authentication:",
            axiosError.response?.data
          );
        } else {
          console.error("Error during authentication:", error);
        }
        throw new Error("Authentication failed. Please try again.");
      }
    };

    await authenticate();
  } catch (error: unknown) {
    console.error("Error during submission:", error);
  }
}



const checkSubmissionDeadline = (deadline: string): boolean => {
  try {
    const deadlineDate = new Date(deadline);
    const currentDate = new Date();
    return currentDate <= deadlineDate;
  } catch (error) {
    console.error("Error parsing or comparing dates:", error);
    throw new Error("Failed to check submission deadline. Please try again.");
  }
};

const submitAssignment = async (
  backendUrl: string,
  snapshotName?: string
): Promise<void> => {
  try {
    const baseDir = process.cwd();
    let snapshotFolderPath = path.join(baseDir, ".subsys", "snapshots");

    if (snapshotName) {
      snapshotFolderPath = path.join(
        baseDir,
        ".subsys",
        "snapshots",
        `${snapshotName}`
      );
    }

    const configFilePath = path.join(baseDir, ".subsys", "config.json");
    const configContent = fs.readFileSync(configFilePath, "utf-8");
    const configData: { studentId: string; assignmentCode: string } =
      JSON.parse(configContent);
    const { studentId, assignmentCode } = configData;

    const formData = new FormData();

    const addFilesToFormData = (
      currentPath: string,
      relativePath: string,
      parentFolderPath: string
    ) => {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const itemRelativePath = path.join(relativePath, item);

        if (fs.statSync(itemPath).isDirectory()) {
          addFilesToFormData(
            itemPath,
            "",
            parentFolderPath + itemRelativePath + "/"
          );
        } else {
          const extension = path.extname(item).toLowerCase();
          if (extension !== ".gz") {
            // Exclude files with .gz extension
            const newFileName = parentFolderPath + itemRelativePath;
            const cleanedFileName = newFileName.replace(/\//g, "_");
            formData.append("files", fs.createReadStream(itemPath), {
              filename: cleanedFileName,
            });
          }
        }
      }
    };

    // Add files from the specified snapshot folder or all snapshots folder
    addFilesToFormData(snapshotFolderPath, "/", snapshotName || "");

    formData.append("studentId", studentId);
    formData.append("assignmentCode", assignmentCode);

    await axios.post(
      `${backendUrl}/api/submit/assignment`,
      formData,
      {
        headers: formData.getHeaders(),
      }
    );
    console.log("Successfully submitted all assignments")

  } catch (error) {
    console.error("Error during submission:", error);
    throw new Error("Failed to submit assignment. Please try again.");
  }
};

const checkAssignmentAndDeadline = async (
  backendUrl: string,
  assignmentCode: string,
  authToken?: string,
  snapShotName?: string
): Promise<void> => {
  try {

    const assignmentsUrl = `${backendUrl}/api/students/byassignment`;
    const response = await axios.get<{ assignments: Assignment[] }>(assignmentsUrl, {
      headers: {
        Authorization: `Bearer ${authToken}`
      }
    });

    const assignmentExists = response.data.assignments.some(
      (assignment) => assignment.assignmentCode === assignmentCode
    );
    if (assignmentExists) {
      console.log("Assignment exists and student has been invited to this assignment...");
      const targetAssignment = response.data.assignments.find(
        (assignment) => assignment.assignmentCode === assignmentCode
      );

      if (targetAssignment) {
        const canSubmit = checkSubmissionDeadline(targetAssignment.deadline);
        console.log("Can submit, continuing...");

        if (canSubmit) {
          const baseDir = process.cwd();
          let snapshotFiles: string[] = [];

          if (snapShotName) {
            const snapshotFile = path.join(
              baseDir,
              ".subsys",
              "snapshots",
              `${snapShotName}.gz`
            );

            if (fs.existsSync(snapshotFile)) {
              snapshotFiles.push(snapshotFile);
            }
          } else {
            const snapshotFolder = path.join(baseDir, ".subsys", "snapshots");
            snapshotFiles = fs.readdirSync(snapshotFolder)
              .filter((file) => file.endsWith(".gz"))
              .map((file) => path.join(snapshotFolder, file));
          }

          for (const snapshotFile of snapshotFiles) {
            const snapshotName = path.basename(snapshotFile, ".gz");
            const snapshotData = await decompressSnapshot(snapshotFile);
            if (snapshotData) {
              recreateTree(snapshotData, baseDir, snapshotName);
              console.log(
                `Deadline has not passed for ${snapshotName}. Continuing with submission...`
              );
              await submitAssignment(backendUrl, snapshotName);
            } else {
              console.error(`Error decompressing snapshot: ${snapshotName}`);
            }
          }
        } else {
          console.error("Can no longer submit after deadline.");
        }
      } else {
        console.error("Error finding the assignment with the given code for specified student.");
      }
    } else {
      console.error(
        "Assignment does not exist. Please check the assignment code."
      );
    }
  } catch (error) {
    console.error("Error checking assignment existence and deadline:", error);
    throw new Error(
      "Failed to check assignment existence and deadline. Please try again."
    );
  }
};
