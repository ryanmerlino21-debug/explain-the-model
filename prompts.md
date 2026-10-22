# Prompts given to my AI coding agent (Claude Code)

A log of what I asked, in order, and what came of each request.

1. **Build the app.** "complete this /Users/ryanmerlino/Downloads/explain-the-model-starter. use all of these screenshots as well" (12 screenshots of the M10 "Explain the Model" assignment site: overview, the three competition briefs, their checklists and the check numbers).
   - Result: the agent read `AGENT_BRIEF.md`, `SCHEMA.md`, `check.md` and the starter code, then rewrote `index.html` and `app.js` into three explainers: Push & Pull, Wisdom of the Forest and One Correction at a Time.

2. **Publish it.** "can you do steps 1-3" (create the GitHub repo, push, turn on GitHub Pages, and put the link in the README).
   - Result: public repo, GitHub Pages from `main` at `/`, README link and takeaway sentences filled in.

3. **Ask for a check.** "is everything 100% how it is supposed to be based off the assignment instructions?"
   - Result: the agent listed what it had and had not verified.

4. **Add the missing assignment pages.** "heres all of the cut off images and some images from the data & files tab. I think theres more data in the /Users/ryanmerlino/Desktop/untitled folder 3 as well. make sure it all is in github app"
   - Result: no new files were found in that folder (only the original 12 screenshots).

5. **Read the real assignment.** "open the assignment and look through everything on my chrome tab" (https://snsie.github.io/regression-activity/)
   - Result: the agent fetched every assignment page and the official starter zip, compared every requirement with the app, and confirmed all starter files were in the repo.

6. **Final check and this log.** "phone layout doesnt matter. make sure everything else is fine. add the prompts.md as well"
   - Result: the agent tested all three sections on all three datasets in a real browser and found a rounding bug (lung-function forest average showed 1,982.6 instead of 1,982.5), fixed it, and added this file.
