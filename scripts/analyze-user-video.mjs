import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';

async function main() {
  const zai = await ZAI.create();

  const prompt = `You are analyzing a screen recording video of an Android app called "Our Habit" (আমাদের অভ্যাস) - an Islamic habit tracker app. The app developer's user recorded this video to demonstrate ALL the problems/bugs in the app.

Watch the video VERY CAREFULLY from start to end. List EVERY problem, bug, or issue the user demonstrates, in chronological order. For each problem describe:
1. What screen/feature is shown
2. What action the user performs
3. What goes wrong (what doesn't work, what's missing, what error appears)
4. The approximate timestamp in the video

Pay special attention to:
- Banner advertisements (do they show or not?)
- Alarm/reminder sounds (meal alarms, Fajr alarm, prayer reminders) - do they ring or not?
- Toggle switches - when turning features ON, is there sound feedback?
- Calendar/habit tracking view
- Home screen layout issues
- Any UI problems, broken features, or missing functionality
- Any text on screen (Bengali/English) that indicates errors or issues

Be extremely thorough and specific. Output a numbered list of every distinct problem shown in the video.`;

  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          {
            type: 'video_url',
            video_url: {
              url: '/home/z/my-project/upload/video_2026-10-29_13-17-57.mp4'
            }
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
