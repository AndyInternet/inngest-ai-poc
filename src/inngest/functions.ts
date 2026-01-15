import { featureValidationFunctions } from "../examples/feature-validation/pipelines";
import { gamesFunctions } from "../examples/games-with-branching/pipelines";

export const functions = [...featureValidationFunctions, ...gamesFunctions];
