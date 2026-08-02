import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executer.ts";
import { createAgentTools } from "../agent/agent-tools.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import { runApprovalFlow } from "../agent/approval.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { generatePlan } from "./planner.ts";
import { printPlan, selectSteps } from "./selection.ts";
import type { PlanStep } from "./types.ts";

function stepPrompt(goal: string, step: PlanStep): string {
    return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join('\n');
}

export async function runPlanMode(): Promise<void> {
    console.log(chalk.bold('\n Plan Mode\n'));


    const goal = await text({ message: "What is your goal?" })
    if (isCancel(goal) || !goal.trim()) return;

    const plan = await generatePlan(goal);

    printPlan(plan)

    const selected = await selectSteps(plan);
    if (selected.length === 0) return;

    // if the user confirms it then shift to the agent mode to execute the task
    const process = await confirm({
        message: `Execute ${selected.length} step(s)`,
        initialValue: true
    });

    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);

    // web search tools only
    const tools = {
        ...createAgentTools(executor)
    }

    for (const step of selected) {
        console.log(chalk.bold(`\n ${step.title}\n`));

        const agent = new ToolLoopAgent({
            model: getAgentModel(),
            stopWhen: stepCountIs(30),
            tools,
        });

        const r = await agent.generate({ prompt: stepPrompt(plan.goal, step) })

        if (r.text) return console.log(renderTerminalMarkdown(r.text))

    }

    const ok = await runApprovalFlow(tracker); // approve the changes
    if (!ok) return executor.clearStaging();

    const { errors } = executor.applyApprovedFromTracker();
    if (errors.length) {
        console.log(chalk.red('\nSome operations reported errors:\n'));
        for (const e of errors) console.log(chalk.red(`  • ${e}`));
    } else {
        console.log(chalk.green('\n✓ Applied.\n'));
    }
    executor.clearStaging();
}
