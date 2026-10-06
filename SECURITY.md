# Security policy

## Supported versions

Only the latest published FrameScript version receives security fixes during the alpha period.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's GitHub private vulnerability reporting feature under **Security → Advisories → Report a vulnerability**.

Include the affected version, operating system, reproduction steps, and whether untrusted source files, plugins, media, or generated projects are involved. Never include registry tokens or private media in a report.

FrameScript plugins execute trusted JavaScript during compilation and may contribute renderer packages. Only install plugins you trust. FFprobe and FFmpeg process local media as external executables; keep them patched independently.
