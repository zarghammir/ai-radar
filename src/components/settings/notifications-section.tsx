"use client";

import { SaveStatusText, Section, useSaveStatus } from "@/components/settings/section";
import { savePreferences } from "@/lib/api/preferences-store";
import { NOTIFICATION_OPTIONS } from "@/lib/api/preferences";
import type { Preferences } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { PushToggle } from "@/components/settings/push-toggle";

/**
 * How the reader hears that the brief is ready.
 *
 * PUSH NOW WORKS; EMAIL STILL DOES NOT. #72 built one of the two channels the
 * preference offers, so this panel no longer says "nothing is sent" — it says
 * which one arrives and which one is still only recorded. The rule that made
 * the old copy honest is the rule that makes this copy specific: a product
 * that quietly accepts "email me at seven" and never writes is worse than one
 * that admits it cannot, so the half that cannot must keep saying so while the
 * half that can stops pretending it cannot.
 */
export function NotificationsSection({ preferences }: { preferences: Preferences }) {
  const { status, run } = useSaveStatus();
  const channel = preferences.notificationChannel;

  return (
    <Section
      title="Being told"
      hint="Recorded now, honoured when delivery is built. Choosing something here changes nothing about what arrives today."
      status={<SaveStatusText status={status} what="how you are told" />}
    >
      <p className="border-faint-2 text-soft mb-4 border border-dashed p-3 text-[13px] leading-relaxed">
        A push notification is sent once a day, soon after your brief time, to every browser you
        switch it on in.{" "}
        {/* There is still no address field, and that is the point rather than
            an omission: #94 removed it because storing one for a feature that
            does not exist collects personal data for nothing. Email remains
            unbuilt — see #72. */}
        <b className="text-ink font-semibold">
          Email is still only recorded — nothing is mailed, and you are not asked for an address
          until something sends to it.
        </b>
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

      {channel === "push" && <PushToggle />}

      {/* Same hazard as the brief length: the column is plain text and only the
          write path validates it, so a channel this build cannot draw leaves
          every radio unchecked — which reads as "not chosen" and is false. */}
      {NOTIFICATION_OPTIONS.some((option) => option.value === channel) ? null : (
        <p className="text-destructive mt-2 text-[12.5px] font-semibold">
          Your saved choice is “{channel}”, which this version does not recognise. Picking one above
          replaces it.
        </p>
      )}
    </Section>
  );
}
