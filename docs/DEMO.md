# 3-minute demo script

Uses the `scholarship-happy` mock scenario, so it runs the same every time with no backend.

## Before recording

1. `npm run dev`, then open <http://localhost:3000/?mock=scholarship-happy> in **Chrome**. Voice
   input needs Chrome and an internet connection.
2. Allow the microphone when Chrome asks. Do one practice run so the permission is saved.
3. Turn your system volume up so AccessPilot's voice is audible in the recording.
4. Zoom the browser to 125% so text is readable in the video.
5. To start fresh, clear site data (DevTools → Application → Clear site data). The first-load
   speech question will appear again.
6. Have this ready to paste: `http://localhost:4000/scholarship`

The scripted run takes about 30 seconds from Start task to the approval question, then about 4
seconds to confirm.

## Script

| Time      | Do                                                                                                 | Say                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:20 | Show the page.                                                                                     | "Many websites are built for mouse users. A screen reader hits unlabeled buttons and a date picker made of divs, and just says 'button, button, image.' AccessPilot fixes that, and keeps the user in control."          |
| 0:20–0:35 | Point at **Do you use your own screen reader?** Choose **Read aloud for me**.                      | "First it asks if you use your own screen reader, so you never hear everything twice. We'll let AccessPilot speak today."                                                                                                |
| 0:35–0:50 | Paste the address. Press **Alt+Shift+M** and say: "Help me complete this scholarship application." | "I can type or talk. What I say goes into the goal box so I can check it first."                                                                                                                                         |
| 0:50–1:00 | Press **Start task**. Let it read the page map.                                                    | "Before doing anything, it tells me what's on the page: a login link, a six-field form, and a Submit button."                                                                                                            |
| 1:00–1:20 | Let it fill the form. Point at the step list, the **Browser preview**, and the screenshot caption. | "A separate browser does the work, and every step is narrated. It found the dropdown with no label and the date picker built from unlabeled buttons. Each screenshot has a description written for screen reader users." |
| 1:20–1:50 | The approval dialog opens. Let it read the details.                                                | "Submitting is consequential, so it stops and reads back every detail. Nothing happens until I answer, and there's no timeout."                                                                                          |
| 1:50–2:05 | Press **Alt+Shift+M** and say "maybe".                                                             | "If my answer isn't a clear yes, it asks again. It never guesses."                                                                                                                                                       |
| 2:05–2:20 | Press **Alt+Shift+M** and say "approve". It announces "Submitted. Confirmation number 4821."       | "Approve. … Done, with the confirmation number."                                                                                                                                                                         |
| 2:20–2:45 | Open `?mock=slow-network`, start any task, then press **Alt+Shift+S**.                             | "And if anything looks wrong, one keypress, or just saying 'stop', halts it instantly and silences the voice."                                                                                                           |
| 2:45–3:00 | Closing line.                                                                                      | "Informed, in control, and asked before anything that matters. That's AccessPilot."                                                                                                                                      |

## Backup plans

- **Microphone doesn't work:** type the goal instead, and use the keyboard in the dialog (Tab to
  **Approve and submit**, then Enter). Mention that voice is optional.
- **Want to show a hand-off:** open `?mock=password-handoff`. It stops at the password field and
  waits for **Continue**.
- **Short on time:** add `&mockSpeed=0.5` to the URL to play the run twice as fast.
