#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
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

const state = Flag.FileParse("state", { format: "json" }).pipe(
  Flag.withDescription("Path to the JSON state file"),
);

const prompt = Flag.String("prompt").pipe(
  Flag.withDescription("Question to answer about the state"),
);

const toState = (value: unknown): EntryType => {
  if (
    value === null ||
    typeof value === "string" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null)
  ) {
    return value as EntryType;
  }

  throw new CliError.UserError({
    cause: new Error("State must be a JSON string, object, array, or null"),
  });
};

const toQuestions = (value: unknown): Questions => {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  ) {
    return value as Questions;
  }

  throw new CliError.UserError({
    cause: new Error("Questions must be a non-empty JSON object"),
  });
};

const typeSafeClient = Effect.try({
  try: () => new TypeSafeClient(),
  catch: (cause) => new CliError.UserError({ cause }),
});

const questions = Flag.FileParse("questions", { format: "json" }).pipe(
  Flag.withDescription("Path to a JSON map of named TypeSafe questions"),
);

const choicesFlag = Flag.Boolean("choices").pipe(
  Flag.withDescription("Read the remaining arguments as possible answers"),
);

const choices = Argument.String("choice").pipe(
  Argument.atLeast(2),
  Argument.withDescription("Two or more possible answers"),
);

const choiceCommand = Command.make(
  "choice",
  { state, prompt, choicesFlag, choices },
  ({ state, prompt, choicesFlag, choices }) =>
    Effect.gen(function* () {
      if (!choicesFlag) {
        return yield* new CliError.UserError({
          cause: new Error("Pass choices after the --choices flag"),
        });
      }

      const criteria = Object.fromEntries(
        choices.map((candidate) => [candidate, null]),
      );

      if (Object.keys(criteria).length < 2) {
        return yield* new CliError.UserError({
          cause: new Error("Choices must contain at least two unique values"),
        });
      }

      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: toState(state),
            questions: {
              answer: choice(prompt, criteria),
            },
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(response.answers.answer.choice);
    }),
).pipe(Command.withDescription("Select one answer from a set of choices"));

const noulCommand = Command.make(
  "noul",
  { state, prompt },
  ({ state, prompt }) =>
    Effect.gen(function* () {
      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: toState(state),
            questions: {
              answer: noul(prompt),
            },
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(response.answers.answer.noul);
    }),
).pipe(Command.withDescription("Return the probability of a yes answer"));

const levelsFlag = Flag.Boolean("levels").pipe(
  Flag.withDescription("Read the remaining arguments as ordered score levels"),
);

const levels = Argument.String("level").pipe(
  Argument.atLeast(2),
  Argument.withDescription("Two or more ordered score descriptions"),
);

const scoreCommand = Command.make(
  "score",
  { state, prompt, levelsFlag, levels },
  ({ state, prompt, levelsFlag, levels }) =>
    Effect.gen(function* () {
      if (!levelsFlag) {
        return yield* new CliError.UserError({
          cause: new Error("Pass score levels after the --levels flag"),
        });
      }

      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: toState(state),
            questions: {
              answer: score(
                prompt,
                levels as readonly [string, string, ...Array<string>],
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
    questions: Flag.optional(questions),
  },
  ({ state, questions }) =>
    Effect.gen(function* () {
      if (Option.isNone(questions)) {
        return yield* new CliError.UserError({
          cause: new Error(
            "Pass --questions to evaluate multiple named questions",
          ),
        });
      }

      if (Option.isNone(state)) {
        return yield* new CliError.UserError({
          cause: new Error("--state is required when --questions is provided"),
        });
      }

      const client = yield* typeSafeClient;
      const response = yield* Effect.tryPromise({
        try: () =>
          client.systemOne({
            state: toState(state.value),
            questions: toQuestions(questions.value),
          }),
        catch: (cause) => new CliError.UserError({ cause }),
      });

      yield* Console.log(JSON.stringify(response, null, 2));
    }),
).pipe(
  Command.withDescription("Ask Jev typed questions about a JSON state file"),
  Command.withSubcommands([choiceCommand, noulCommand, scoreCommand]),
);

Command.run(cli, { version: "0.1.0" }).pipe(
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);