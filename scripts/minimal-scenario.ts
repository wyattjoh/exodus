import {
  compileScenario,
  formatScenarioInspection,
  inspectScenario,
  minimalScenario,
} from "../src/index";

const result = compileScenario(minimalScenario);
if (!result.ok) {
  console.error("Minimal Scenario is invalid:");
  for (const issue of result.issues) {
    console.error(`- [${issue.code}] ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
} else {
  console.log(formatScenarioInspection(inspectScenario(result.scenario)));
}
