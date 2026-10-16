import { OnboardingFlow } from "@/mobile/onboarding/onboarding-flow";

// Phone first-run setup. MobileRoot sends an unconnected phone here and a
// connected one away from here.
export default function MobileOnboarding() {
  return <OnboardingFlow />;
}
