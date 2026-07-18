#!/usr/bin/env bun

import { Command } from "commander";

const program = new Command();

program
    .name("openclaw-build")
    .description("openclaw cli PC")
    .version("0.0.1");

program
    .command("wakeup")
    .description("Show the banner and pick cli or telegram mode")
    .action(async () => {
        console.log("Wakeup Calling....");
    });

await program.parseAsync(process.argv);
