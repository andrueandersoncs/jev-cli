#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import packageMetadata from "./package.json" with { type: "json" };
import {
  choice,
  type EntryType,
  type Questions,
  noul,
  score,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import { Console, Effect, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/unstable/cli";

const userError = (message: string) =>
  new CliError.UserError({ cause: new Error(message) });

const jsonFlag = (name: string) =>
  Flag.String(name).pipe(
    Flag.mapTryCatch(
      (value) => JSON.parse(value) as unknown,
      () => `--${name} must contain valid JSON`,
    ),
  );

const state = jsonFlag("state").pipe(
  Flag.withDescription("Inline JSON state"),
);

const stateFile = Flag.FileParse("state-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON state file"),
);

const prompt = Flag.String("prompt").pipe(
  Flag.withDescription("Inline question to answer about the state"),
);

const promptFile = Flag.FileText("prompt-file").pipe(
  Flag.withDescription("Path to a text file containing the question"),
);

const questions = jsonFlag("questions").pipe(
  Flag.withDescription("Inline JSON map of named TypeSafe questions"),
);

const questionsFile = Flag.FileParse("questions-file", {
  format: "json",
}).pipe(
  Flag.withDescription("Path to a JSON map of named TypeSafe questions"),
);

const choicesFlag = Flag.Boolean("choices").pipe(
  Flag.withDescription("Read the remaining arguments as possible answers"),
);

const choicesFile = Flag.FileParse("choices-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON array of possible answers"),
);

const choiceValues = Argument.String("choice").pipe(
  Argument.atMost(Number.MAX_SAFE_INTEGER),
  Argument.withDescription("Two or more possible answers"),
);

const levelsFlag = Flag.Boolean("levels").pipe(
  Flag.withDescription("Read the remaining arguments as ordered score levels"),
);

const levelsFile = Flag.FileParse("levels-file", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON array of ordered score levels"),
);

const levelValues = Argument.String("level").pipe(
  Argument.atMost(Number.MAX_SAFE_INTEGER),
  Argument.withDescription("Two or more ordered score descriptions"),
);

const resolveInput = <A>(
  name: string,
  inline: Option.Option<A>,
  file: Option.Option<A>,
): Effect.Effect<A, CliError.UserError> => {
  if (Option.isSome(inline) && Option.isSome(file)) {
    return Effect.fail(
      userError(`Pass only one of --${name} or --${name}-file`),
    );
  }

  if (Option.isSome(inline)) {
    return Effect.succeed(inline.value);
  }

  if (Option.isSome(file)) {
    return Effect.succeed(file.value);
  }

  return Effect.fail(
    userError(`Pass exactly one of --${name} or --${name}-file`),
  );
};
const toStringArray = (
  name: string,
  value: unknown,
): Effect.Effect<ReadonlyArray<string>, CliError.UserError> => {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string")
  ) {
    return Effect.fail(
      userError(`--${name}-file must contain a JSON array of strings`),
    );
  }

  return Effect.succeed(value);
};


const resolveListInput = (
  name: string,
  inlineFlag: Option.Option<boolean>,
  inlineValues: ReadonlyArray<string>,
  file: Option.Option<unknown>,
): Effect.Effect<ReadonlyArray<string>, CliError.UserError> => {
  if (Option.isSome(inlineFlag) && !inlineFlag.value) {
    return Effect.fail(userError(`--no-${name} is not supported`));
  }

  const inlineRequested =
    Option.isSome(inlineFlag) && inlineFlag.value === true;

  if (inlineValues.length > 0 && !inlineRequested) {
    return Effect.fail(
      userError(`Pass inline ${name} after the --${name} flag`),
    );
  }

  const inline: Option.Option<unknown> = inlineRequested
    ? Option.some(inlineValues)
    : Option.none();

  return resolveInput(name, inline, file).pipe(
    Effect.flatMap((value) => toStringArray(name, value)),
  );
};

const toState = (value: unknown) =>
  value === null ||
  typeof value === "string" ||
  Array.isArray(value) ||
  (typeof value === "object" && value !== null)
    ? Effect.succeed(value as EntryType)
    : Effect.fail(
        userError("State must be a JSON string, object, array, or null"),
      );

const toQuestions = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0
    ? Effect.succeed(value as Questions)
    : Effect.fail(userError("Questions must be a non-empty JSON object"));

const typeSafeClient = Effect.try({
  try: () => new TypeSafeClient(),
  catch: (cause) => new CliError.UserError({ cause }),
});

const choiceCommand = Command.make(
  "choice",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
    choicesFlag: Flag.optional(choicesFlag),
    choicesFile: Flag.optional(choicesFile),
    choices: choiceValues,
  },
  ({
    state,
    stateFile,
    prompt,
    promptFile,
    choicesFlag,
    choicesFile,
    choices,
  }) =>
    Effect.gen(function* () {
      const resolvedState = yield* resolveInput("state", state, stateFile);
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const resolvedChoices = yield* resolveListInput(
        "choices",
        choicesFlag,
        choices,
        choicesFile,
      );
      const validatedState = yield* toState(resolvedState);

      const criteria = Object.fromEntries(
        resolvedChoices.map((candidate) => [candidate, null]),
      );

      if (Object.keys(criteria).length < 2) {
        return yield* userError(
          "Choices must contain at least two unique values",
        );
      }

      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: validatedState,
            questions: {
              answer: choice(resolvedPrompt, criteria),
            },
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(response.answers.answer.choice);
    }),
).pipe(Command.withDescription("Select one answer from a set of choices"));

const noulCommand = Command.make(
  "noul",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
  },
  ({ state, stateFile, prompt, promptFile }) =>
    Effect.gen(function* () {
      const resolvedState = yield* resolveInput("state", state, stateFile);
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const validatedState = yield* toState(resolvedState);
      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: validatedState,
            questions: {
              answer: noul(resolvedPrompt),
            },
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(response.answers.answer.noul);
    }),
).pipe(Command.withDescription("Return the probability of a yes answer"));

const scoreCommand = Command.make(
  "score",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    prompt: Flag.optional(prompt),
    promptFile: Flag.optional(promptFile),
    levelsFlag: Flag.optional(levelsFlag),
    levelsFile: Flag.optional(levelsFile),
    levels: levelValues,
  },
  ({
    state,
    stateFile,
    prompt,
    promptFile,
    levelsFlag,
    levelsFile,
    levels,
  }) =>
    Effect.gen(function* () {
      const resolvedState = yield* resolveInput("state", state, stateFile);
      const resolvedPrompt = yield* resolveInput("prompt", prompt, promptFile);
      const resolvedLevels = yield* resolveListInput(
        "levels",
        levelsFlag,
        levels,
        levelsFile,
      );
      const validatedState = yield* toState(resolvedState);

      if (resolvedLevels.length < 2) {
        return yield* userError("Levels must contain at least two values");
      }

      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: validatedState,
            questions: {
              answer: score(
                resolvedPrompt,
                resolvedLevels as readonly [
                  string,
                  string,
                  ...Array<string>,
                ],
              ),
            },
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(response.answers.answer.score);
    }),
).pipe(Command.withDescription("Score state against an ordered rubric"));

const cli = Command.make(
  "jev",
  {
    state: Flag.optional(state),
    stateFile: Flag.optional(stateFile),
    questions: Flag.optional(questions),
    questionsFile: Flag.optional(questionsFile),
  },
  ({ state, stateFile, questions, questionsFile }) =>
    Effect.gen(function* () {
      const resolvedState = yield* resolveInput("state", state, stateFile);
      const resolvedQuestions = yield* resolveInput(
        "questions",
        questions,
        questionsFile,
      );
      const validatedState = yield* toState(resolvedState);
      const validatedQuestions = yield* toQuestions(resolvedQuestions);
      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: validatedState,
            questions: validatedQuestions,
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(JSON.stringify(response, null, 2));
    }),
).pipe(
  Command.withDescription("Ask Jev typed questions about JSON state"),
  Command.withSubcommands([choiceCommand, noulCommand, scoreCommand]),
);

Command.run(cli, { version: packageMetadata.version }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);