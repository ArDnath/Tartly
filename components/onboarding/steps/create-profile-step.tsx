"use client";

import { ImageUp, Loader2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState, type ChangeEvent } from "react";

import { useOnboarding } from "@/components/onboarding/onboarding-provider";
import { OnboardingStepAnimatedItem } from "@/components/onboarding/onboarding-step-animated-item";
import {
  OnboardingContentBlock,
  OnboardingStepHeading,
  OnboardingStepPage,
  OnboardingStepTitle,
} from "@/components/onboarding/onboarding-step-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import logo from "@/public/logo.png";

const MAX_AVATAR_BYTES = 1_000_000;

export const CreateProfileStep = () => {
  const { state, user, advance, isNavigating } = useOnboarding();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [jobTitle, setJobTitle] = useState(state.jobTitle ?? "");
  const [image, setImage] = useState<string | null>(user.image);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isValid = firstName.trim().length > 0;

  const handleAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || file.size > MAX_AVATAR_BYTES) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <OnboardingStepPage>
      <OnboardingStepHeading>
        <OnboardingStepAnimatedItem index={0}>
          <div className="text-center">
            <OnboardingStepTitle>Create profile</OnboardingStepTitle>
          </div>
        </OnboardingStepAnimatedItem>
      </OnboardingStepHeading>

      <OnboardingStepAnimatedItem index={1}>
        <OnboardingContentBlock className="gap-6">
          <div className="flex items-end gap-3 max-sm:flex-col max-sm:items-stretch">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload profile picture"
              className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-secondary text-muted-foreground transition-colors hover:bg-accent"
            >
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt=""
                  className="size-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Image
                  src={logo}
                  alt="Lunabox logo"
                  width={48}
                  height={48}
                  className="size-full object-cover"
                />
              )}
              <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-accent">
                <ImageUp className="size-2.5" />
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />

            <div className="flex min-w-0 flex-1 gap-3 max-sm:flex-col">
              <div className="flex flex-1 flex-col gap-1.5">
                <label
                  htmlFor="onboarding-first-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  First name
                </label>
                <Input
                  id="onboarding-first-name"
                  autoFocus
                  value={firstName}
                  placeholder="Ada"
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label
                  htmlFor="onboarding-last-name"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Last name (optional)
                </label>
                <Input
                  id="onboarding-last-name"
                  value={lastName}
                  placeholder="Lovelace"
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="onboarding-job-title"
              className="text-xs font-medium text-muted-foreground"
            >
              Job title
            </label>
            <Input
              id="onboarding-job-title"
              value={jobTitle}
              placeholder="Head of Partnerships"
              onChange={(event) => setJobTitle(event.target.value)}
            />
          </div>
        </OnboardingContentBlock>
      </OnboardingStepAnimatedItem>

      <OnboardingStepAnimatedItem index={2}>
        <OnboardingContentBlock>
          <Button
            type="button"
            className="w-full"
            disabled={!isValid || isNavigating}
            onClick={() =>
              advance({
                action: "complete",
                data: {
                  firstName: firstName.trim(),
                  lastName: lastName.trim(),
                  jobTitle: jobTitle.trim(),
                  ...(image ? { image } : {}),
                },
              })
            }
          >
            {isNavigating ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue
          </Button>
        </OnboardingContentBlock>
      </OnboardingStepAnimatedItem>
    </OnboardingStepPage>
  );
};
