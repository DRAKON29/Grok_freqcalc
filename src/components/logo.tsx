import Image from "next/image";

export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.svg"
      alt="Giga Studio"
      width={685}
      height={78}
      className={className}
      priority
    />
  );
}
