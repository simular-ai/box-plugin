---
name: get-started
description: Explain what box by Simular does and help the user connect it and try a first task. Use when the user first installs box or asks what box can do.
---

# Get started with box

box is the user's own cloud Linux computer: a desktop with Chrome, a shell and desktop apps. You drive it with the box tools, so tasks that need a real computer run there instead of on the user's machine.

1. Explain this in two or three sentences.
2. If the box tools ask for sign-in, tell the user to sign in once with their Simular account (Google or GitHub) when the connection asks. After that it just works. A sleeping box wakes on the first call, which can take a few seconds.
3. Mention that they can watch the box live and take over at any time at https://box.simular.ai/box.
4. Offer three things to try:
   - "Use box to search Google for Simular and summarize the top 3 results."
   - "In box, clone github.com/simular-ai/box-plugin and tell me what the cli folder does."
   - "Use box to write a packing list in the text editor, save it and take a screenshot."

When a step needs the user (a sign-in, a password, a 2FA code, a captcha or a payment), stop and ask them to do it on their box. Never ask for passwords in chat.

When a site in the box's browser shows a sign-in page, don't ask the user for the password. If they use Chrome on a Mac, they can bring that site's sign-in into the box with the box desktop app (the box's Settings > Sign-ins > Import from Chrome) or by running `npx @simular-ai/box credentials import` in a terminal. Either way, they can also sign in themselves in the box's live view. You can only suggest the import, not start it, and some sites still ask to sign in after one.
