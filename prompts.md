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

7. **Check the build.** "is everything correct based off the assignment instructions? is it good to submit? also give me the link to submit"
   - Result: the agent re-checked the repo and the live link and gave the repo link to submit.

8. **Optional extensions.** "are the 2 optional extensions important to include?"
   - Result: the agent said no (they don't affect eligibility or earn votes), so they were left out.

9. **Reduce clutter.** "are you able to make this more user friendly and not so cluttered?"
   - Result: secondary detail (trees 1-5 cards, five-person table, residual plot, feature-by-feature table) was moved into expandable sections. Everything the assignment requires stays visible.

10. **Keep it on a branch first.** "save this in a new branch so i can see if i want to save it or not"
    - Result: the changes were committed to a `declutter` branch and `main` was left alone.

11. **Preview links.** "can you give me a link to the main branch app and a link to the decluttered"
    - Result: the agent gave the Pages link for `main` and a raw.githack.com preview link for the branch, because Pages only serves `main`.

12. **Decide whether to merge.** "i cant view the decluttered branch. do you think it is good to merge onto main? is it better than the main"
    - Result: the agent saved side-by-side screenshots of both versions to the Desktop and recommended merging.

13. **Merge and clean up.** "merge it", then "delete declutter if everything is onto main now"
    - Result: `declutter` was fast-forward merged into `main`, the live site was re-tested (37 browser checks passed), and the branch was deleted.

14. **Final check.** "make sure everything is how the assignment wants it", then "make sure prompts.md is updated and github is correct"
    - Result: the agent re-checked the live app against every assignment checklist (27 checks passed) and updated this file.
