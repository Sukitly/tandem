import { runService } from "./service-command.ts";

process.exitCode = await runService(process.argv.slice(2));
