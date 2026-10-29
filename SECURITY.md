# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- the Cast device model and firmware, when the problem involves a device;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, IP addresses and media URLs first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Google Cast devices and their firmware (report those to
[Google](https://bughunters.google.com/)), and the apps that cast to them.

## Security model

What the integration does, so a report can be weighed against it:

- **Local network only.** It opens TCP connections to the Cast devices of the
  local network (port 8009, and the port a speaker group advertises), at the
  addresses the Gladys core found by mDNS or the user typed. It never listens
  on a port and talks to no cloud service. The only other outbound requests
  fetch the artwork of what plays (the image URL the device reports), for the
  dashboard widget, capped at 300 KB.
- **Cast TLS certificates are not verified.** Cast devices present a
  certificate issued by Google's device CA for their own serial number, never
  for an address, and every Cast sender connects without checking it: so does
  this integration. A host able to impersonate a Cast device on the local
  network can therefore receive the commands sent to it (volume, media URLs,
  text-to-speech clip URLs). Keep untrusted devices off the network of your
  Cast devices.
- **Inputs are bounded.** Cast frames above 64 KiB close the connection;
  malformed payloads are ignored. Media URLs must be `http(s)`; Cast app ids
  are alphanumeric. Widget buttons only carry the parameters the integration
  declared.
- **Sandbox.** The container runs as a non-root user with a read-only root
  filesystem; the integration writes nothing to disk. Its only runtime
  dependency is the official Gladys SDK.
- **Logs** contain device names and addresses, never the Gladys token.
