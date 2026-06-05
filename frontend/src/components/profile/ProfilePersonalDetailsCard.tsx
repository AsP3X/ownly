// Human: Personal details form card — Pencil Profile Details Form Card.
// Agent: CONTROLLED draft fields; EMITS onChange per field; email read-only from API.

import {
  ProfileCard,
  ProfileCardHeader,
  ProfileDivider,
  ProfileFieldLabel,
  ProfileTextInput,
  ProfileTextarea,
} from "@/components/profile/profile-ui";
import type { ProfileDetailsDraft } from "@/lib/profile-details-storage";

export type ProfilePersonalDetailsCardProps = {
  draft: ProfileDetailsDraft;
  email: string;
  onChange: (draft: ProfileDetailsDraft) => void;
  /** Human: Anchor id for section nav scroll targets — differs between /profile and /settings. */
  sectionId?: string;
};

/** Human: Two-column personal details form with bio textarea per Pencil right column. */
export function ProfilePersonalDetailsCard({
  draft,
  email,
  onChange,
  sectionId = "profile-details",
}: ProfilePersonalDetailsCardProps) {
  const update = (patch: Partial<ProfileDetailsDraft>) => {
    onChange({ ...draft, ...patch });
  };

  return (
    <ProfileCard id={sectionId}>
      <div className="flex flex-col gap-4">
        <ProfileCardHeader
          title="Personal Details"
          description="Update your public profile, job title, and organization settings."
        />
        <ProfileDivider />

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-full-name">Full Name</ProfileFieldLabel>
              <ProfileTextInput
                id="profile-full-name"
                value={draft.fullName}
                onChange={(event) => update({ fullName: event.target.value })}
                autoComplete="name"
              />
            </div>
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-email">Email Address</ProfileFieldLabel>
              <ProfileTextInput id="profile-email" value={email} readOnly aria-readonly />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-job-title">Job Title</ProfileFieldLabel>
              <ProfileTextInput
                id="profile-job-title"
                value={draft.jobTitle}
                onChange={(event) => update({ jobTitle: event.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <ProfileFieldLabel htmlFor="profile-department">Department</ProfileFieldLabel>
              <ProfileTextInput
                id="profile-department"
                value={draft.department}
                onChange={(event) => update({ department: event.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <ProfileFieldLabel htmlFor="profile-bio">Professional Bio / Notes</ProfileFieldLabel>
            <ProfileTextarea
              id="profile-bio"
              value={draft.bio}
              onChange={(event) => update({ bio: event.target.value })}
              rows={4}
            />
          </div>
        </div>
      </div>
    </ProfileCard>
  );
}
