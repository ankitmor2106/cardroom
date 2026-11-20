import { z } from "zod";

export const gameIdSchema = z.enum(["blackjack", "holdem", "teen-patti", "callbreak", "rummy-13", "rummy-10"]);
export const displayNameSchema = z.string().trim().min(2).max(20).regex(/^[\p{L}\p{N} _.-]+$/u, "Use letters, numbers, spaces, dots, dashes, or underscores.");
export const createRoomSchema = z.object({
  name: z.string().trim().min(3).max(32), gameId: gameIdSchema,
  maxPlayers: z.number().int().min(1).max(9), visibility: z.enum(["public", "private"]),
  password: z.string().min(4).max(64).optional(), displayName: displayNameSchema,
  gameOptions: z.object({ teenPatti: z.object({
    startingStack: z.number().int().min(20).max(1_000_000_000),
    bootAmount: z.number().int().min(1).max(1_000_000),
    maxPot: z.number().int().min(3).max(50_000_000),
  }).strict() }).strict().optional(),
}).superRefine((v, ctx) => {
  if (v.gameId !== "blackjack" && v.maxPlayers < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "This game requires at least two players.", path: ["maxPlayers"] });
  if (v.gameId === "callbreak" && v.maxPlayers !== 4) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Callbreak requires exactly four players.", path: ["maxPlayers"] });
  if (v.gameId === "blackjack" && v.maxPlayers > 9) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Blackjack supports up to nine players.", path: ["maxPlayers"] });
  if (v.gameId === "teen-patti" && v.maxPlayers > 6) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Teen Patti supports up to six players.", path: ["maxPlayers"] });
  if (v.gameId === "holdem" && v.maxPlayers > 9) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Hold'em supports up to nine players.", path: ["maxPlayers"] });
  if (v.visibility === "public" && v.password) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Public rooms cannot have a password.", path: ["password"] });
  if (v.gameOptions && v.gameId !== "teen-patti") ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Game options are only supported for Teen Patti rooms.", path: ["gameOptions"] });
  if (v.gameOptions?.teenPatti) {
    const options = v.gameOptions.teenPatti;
    if (options.startingStack < options.bootAmount * 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Each starting stack must cover the boot and one minimum opening wager.", path: ["gameOptions", "teenPatti", "startingStack"] });
    if (options.maxPot < options.bootAmount * (v.maxPlayers + 1)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Maximum pot must cover every selected seat's boot and one minimum opening wager.", path: ["gameOptions", "teenPatti", "maxPot"] });
  }
});
export const joinRoomSchema = z.object({ displayName: displayNameSchema, password: z.string().max(64).optional() });
export const readySchema = z.object({ ready: z.boolean() });
export const actionEnvelopeSchema = z.object({ seq: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(), action: z.string().min(1).max(32), payload: z.record(z.unknown()).default({}) });
export const chatSchema = z.object({ text: z.string().trim().min(1).max(300) });
export const profileSchema = z.object({ displayName: displayNameSchema, avatar: z.string().max(32) });
