"use client";

import { useId, useSyncExternalStore } from "react";
import { PROFILE_NOTES_MAX_LENGTH, type ProfileDetails } from "@/lib/contracts";
import { EMPTY_PROFILE, profileStore } from "@/lib/client/profile";
import { buttonStyles, hintStyles, inputStyles, labelStyles } from "./ui/styles";

const FIELDS: {
  key: "name" | "email" | "phone";
  label: string;
  type: string;
  autoComplete: string;
  max: number;
}[] = [
  { key: "name", label: "Full name", type: "text", autoComplete: "name", max: 200 },
  { key: "email", label: "Email", type: "email", autoComplete: "email", max: 200 },
  { key: "phone", label: "Phone", type: "tel", autoComplete: "tel", max: 50 },
];

/**
 * "Your details": what AccessPilot may type into forms for you. Saved in this browser only and sent
 * with each task you start. Passwords and card numbers never go here; the agent hands those back.
 */
export function ProfileSection() {
  const id = useId();
  const profile = useSyncExternalStore(
    profileStore.subscribe,
    profileStore.getSnapshot,
    profileStore.getServerSnapshot,
  );
  const update = (patch: Partial<ProfileDetails>) => profileStore.update(patch);

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <div className="space-y-1">
        <h3 id={`${id}-heading`} className="text-sm font-semibold">
          Your details
        </h3>
        <p id={`${id}-about`} className={hintStyles}>
          AccessPilot uses these to fill in forms you ask for, and shows them to you before anything
          is submitted. Saved in this browser only. Never put passwords or card numbers here:
          AccessPilot always asks you to type those yourself.
        </p>
      </div>

      {FIELDS.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <label htmlFor={`${id}-${field.key}`} className={labelStyles}>
            {field.label}
          </label>
          <input
            id={`${id}-${field.key}`}
            type={field.type}
            autoComplete={field.autoComplete}
            maxLength={field.max}
            value={profile[field.key]}
            onChange={(event) => update({ [field.key]: event.target.value })}
            className={inputStyles}
          />
        </div>
      ))}

      <div className="space-y-1.5">
        <label htmlFor={`${id}-notes`} className={labelStyles}>
          Anything else forms might ask
        </label>
        <textarea
          id={`${id}-notes`}
          rows={4}
          maxLength={PROFILE_NOTES_MAX_LENGTH}
          aria-describedby={`${id}-notes-hint`}
          value={profile.notes}
          onChange={(event) => update({ notes: event.target.value })}
          className={inputStyles}
        />
        <p id={`${id}-notes-hint`} className={hintStyles}>
          For example your program, start date, address, or a short personal statement.
        </p>
      </div>

      <button
        type="button"
        onClick={() => update(EMPTY_PROFILE)}
        className={buttonStyles.secondary}
      >
        Clear my details
      </button>
    </section>
  );
}
