"use client";

import { useId, useState } from "react";
import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
import { savePreferences } from "@/lib/api/preferences-store";
import { NOTIFICATION_LABELS, NOTIFICATION_OPTIONS } from "@/lib/api/preferences";
import type { NotificationChannel, Preferences } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/**
 * How the reader hears that the brief is ready.
 *
 * NOTHING SENDS ANYTHING YET. The preference is real and it is stored, but no
 * code reads notification_channel to deliver a brief — there is no push
 * subscription and no mail path in this repository. The screen says so in
 * plain words rather than presenting a working feature, because a product that
 * quietly accepts "email me at seven" and then never writes is worse than one
 * that admits it cannot yet: the reader stops opening the app and concludes
 * there is no news.
 */
export function NotificationsSection({ preferences }: { preferences: Preferences }) {
  const { status, run } = useSaveStatus();
  const channel = preferences.notificationChannel;
  const needsEmail = NOTIFICATION_LABELS[channel as NotificationChannel]?.needsEmail ?? false;

  return (
    <Section
      title="Being told"
      hint="Recorded now, honoured when delivery is built. Choosing something here changes nothing about what arrives today."
      status={<SaveStatusText status={status} what="how you are told" />}
    >
      <p className="border-faint-2 text-soft mb-4 border border-dashed p-3 text-[13px] leading-relaxed">
        Nothing is sent yet — not a push, not an email. The choice is kept so it is already right
        when sending arrives, and until then the brief waits for you on Today.
      </p>

      <fieldset>
        <legend className="sr-only">How you hear that the brief is ready</legend>
        <div className="flex flex-col gap-2">
          {NOTIFICATION_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 border p-3",
                option.value === channel ? "border-ink" : "border-faint-2 hover:bg-faint",
              )}
            >
              <input
                type="radio"
                name="notification-channel"
                value={option.value}
                checked={option.value === channel}
                onChange={() =>
                  void run(() => savePreferences({ notificationChannel: option.value }))
                }
                className="accent-ink focus-visible:ring-org mt-0.5 size-4 shrink-0 focus-visible:ring-2 focus-visible:outline-none"
              />
              <span>
                <span className="block text-[14px] font-semibold">{option.label}</span>
                <span className="text-soft block text-[13px] leading-relaxed">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Same hazard as the brief length: the column is plain text and only the
          write path validates it, so a channel this build cannot draw leaves
          every radio unchecked — which reads as "not chosen" and is false. */}
      {NOTIFICATION_OPTIONS.some((option) => option.value === channel) ? null : (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">
          Your saved choice is “{channel}”, which this version does not recognise. Picking one above
          replaces it.
        </p>
      )}

      {needsEmail ? (
        <EmailField
          email={preferences.email}
          onSave={(email) => run(() => savePreferences({ email }))}
        />
      ) : null}
    </Section>
  );
}

/**
 * Shown only when the chosen channel needs it. An address with nowhere to send
 * from is a field the reader fills in for nothing, and a channel chosen with
 * no address is a setting that cannot work — so the two appear together and
 * the second says when it is missing.
 */
function EmailField({
  email,
  onSave,
}: {
  email: string | null;
  onSave: (email: string | null) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(email ?? "");
  const changed = draft.trim() !== (email ?? "");
  const value = draft.trim();
  // The route validates with zod's email rule; this is the same question asked
  // early enough to answer beside the field.
  const valid = value.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  return (
    <div className="mt-4">
      <label
        htmlFor={id}
        className="font-label text-soft block text-[10.5px] font-bold tracking-[0.18em] uppercase"
      >
        Where to write to
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={draft}
          placeholder="you@example.com"
          onChange={(event) => setDraft(event.target.value)}
          aria-invalid={!valid}
          className="border-faint-2 bg-paper text-ink focus-visible:ring-org min-w-0 flex-1 border px-2 py-1.5 text-[14px] focus-visible:ring-2 focus-visible:outline-none"
        />
        {changed ? (
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSave(value.length === 0 ? null : value)}
            className="focus-visible:ring-org bg-ink text-paper border-ink rounded-xs border px-2.5 py-1.5 text-[13px] font-semibold focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save address
          </button>
        ) : null}
      </div>
      {!valid ? (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">
          That does not look like an email address.
        </p>
      ) : null}
      {email === null ? (
        <p className="text-meta mt-2 text-[12.5px]">
          No address saved, so email could not reach you even once sending is built.
        </p>
      ) : null}
    </div>
  );
}
