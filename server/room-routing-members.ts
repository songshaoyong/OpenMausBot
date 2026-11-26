import type { GroupDefaultResponder } from "./store.ts";

export function roomTurnMembers<Member extends { id: string; hidden?: boolean }>(
  members: readonly Member[],
  heldInRoom: (member: Member) => boolean,
  botHeld: (member: Member) => boolean,
) {
  const availableMembers = members.filter((member) => !member.hidden);
  const goalMembers = availableMembers.filter((member) => !heldInRoom(member));
  const routableMembers = goalMembers.filter((member) => !botHeld(member));
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
