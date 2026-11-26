import type { GroupDefaultResponder } from "./store.ts";

export function roomTurnMembers<Member extends { id: string; hidden?: boolean; home?: { gone?: unknown } }>(
  members: readonly Member[],
  heldInRoom: (member: Member) => boolean,
  botHeld: (member: Member) => boolean,
) {
  const availableMembers = members.filter((member) => !member.hidden);
  const present = availableMembers.filter((member) => !heldInRoom(member));
  // A member that lives in another of the person's places (`home`) answers in the room; it does not lead a team run here.
  const goalMembers = present.filter((member) => !member.home);
  // One that cannot be reached now (its link is off, or its place no longer has it) stays a member and is picked by nobody but the person naming it.
  const routableMembers = present.filter((member) => !botHeld(member) && !member.home?.gone);
  return { availableMembers, goalMembers, routableMembers };
}

const rolePhrase = (text: string) => text.slice(0, 8_000).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, " ").trim();

/** Only a unique, complete role match can override the lead without a model decision. */
export function localRoomResponder<Member extends { title?: string }>(text: string, members: readonly Member[]): Member | undefined {
  const message = ` ${rolePhrase(text)} `;
  const matches = members.filter((member) => {
    const title = rolePhrase(member.title ?? "");
    if (title.length < 2) return false;
    // CJK scripts need no spaces between the role and the surrounding sentence.
    return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(title)
      ? message.includes(title)
      : message.includes(` ${title} `);
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function autoRoomDefault(
  responder: GroupDefaultResponder,
  routableMembers: readonly { id: string }[],
  replyBot?: { id: string },
): GroupDefaultResponder {
  if (responder.kind !== "auto") return responder;
  const lead = replyBot ?? routableMembers.find((member) => member.id === responder.fallbackBotId) ?? routableMembers[0];
  return lead ? { kind: "member", botId: lead.id } : responder;
}
