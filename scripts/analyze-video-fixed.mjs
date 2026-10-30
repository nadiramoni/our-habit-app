import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function main() {
  const zai = await ZAI.create();

  const prompt = `This is a screen recording of an Android app "Our Habit" (আমাদের অভ্যাস), an Islamic habit tracker app. The user recorded this video to demonstrate ALL bugs/problems in the app to the developer.

Watch the ENTIRE video carefully. Produce a numbered chronological list of EVERY problem/issue demonstrated. For each item include:
- Timestamp (mm:ss)
- What screen is shown (describe UI elements, Bengali text visible)
- What the user does
- What the problem is (e.g., banner ad area empty, no sound when toggling alarm, calendar shows wrong data, feature missing)

Pay special attention to:
1. Banner advertisement slots — are they blank/empty?
2. Alarms (meal alarm/ভোজন আলার্ম, Fajr alarm, prayer/নামাজ reminders, water alarm) — any evidence they don't ring
3. Toggle switches — sound feedback when switching ON/OFF
4. Calendar view / habit check-in screen
5. Home screen layout (habits list, "+ New Habit" button)
6. Any settings screens (Alarm & Reminder section)
7. Notifications

Also transcribe any clearly readable Bengali text on screen that labels features. Be exhaustive — the user says "I showed ALL problems in this video".`;

  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'video_url',
            video_url: { url: '/home/z/my-project/upload/video_fixed.mp4' }
          }
        ]
      }
    ],
    thinking: { type: 'enabled' }
  });

  const content = response.choices[0]?.message?.content;
  fs.writeFileSync('/home/z/my-project/tool-results/video-analysis.md', content || 'NO CONTENT');
  console.log(content);
}

main().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
