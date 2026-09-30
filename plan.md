# Phase 1 — Initial setup (Day 1)
Goal: Get your development environment and accounts ready

## 1. Create your accounts
* Create a GitHub account (if you don't have one).
* Create a Vercel account.
* Create a Supabase account.
* Connect Vercel to GitHub.
* Verify that all accounts are accessible.

Links:
* GitHub
* Vercel
* Supabase

## 2. Prepare your local project
* Create your React/Vite application.
* Verify that it runs locally.
* Initialize Git.
* Create a GitHub repository.
* Push your initial code to GitHub.
* Add a `.gitignore` file.
* Make sure `.env` files are excluded from Git.

Deliverable: Your application runs locally and your code is backed up in GitHub.

# Phase 2 — Database and backend (Day 2–3)

Goal: Get Supabase working

## 3. Create your Supabase project

* Open the Supabase dashboard.

* Create a new project.

* Name it after your application.

* Select the Free plan.

* Select Frankfurt (`eu-central-1`) as the region.

* Generate and securely save your database password.

* Wait for the project to finish provisioning.

## 4. Configure your database

* Identify the database tables your application needs.

* Create the necessary tables.

* Define primary keys and foreign keys.

* Define relationships between tables.

* Add appropriate indexes.

* Enable Row Level Security (RLS).

* Configure policies for reading, inserting, updating and deleting.

* Test access restrictions using different users.

Important: Never assume that hiding something in your React frontend makes it secure. Database permissions must be enforced by Supabase.

## 5. Connect your frontend to Supabase

* Install `@supabase/supabase-js`.

* Create `src/lib/supabase.ts`.

* Add the Supabase URL to your environment variables.

* Add your Supabase publishable/anonymous key.

* Test a database read.

* Test a database write.

* Test authentication if needed.

* Verify that unauthorized users cannot access restricted data.

Deliverable: Your frontend can communicate with your database securely.

# Phase 3 — Frontend development (Day 4–12)

Goal: Build the actual application

## 6. Establish the frontend structure

* Set up routing.

* Create your main layout.

* Create reusable components.

* Set up styling.

* Implement navigation.

* Implement loading states.

* Implement error states.

* Implement empty states.

* Make the application responsive.

## 7. Implement the core features

I recommend prioritizing features using three categories:

Must have

Core functionality

* Main user journey works end-to-end.

* Data can be created.

* Data can be read.

* Data can be updated.

* Data can be deleted, if applicable.

* Authentication works, if applicable.

Should have

Usability

* Form validation.

* Clear error messages.

* Loading indicators.

* Mobile layout.

* Basic accessibility.

Nice to have

Polish

* Animations.

* Advanced styling.

* Dark mode.

* Additional settings.

* Advanced filtering.

Rule: Don't start implementing nice-to-have features until the core user journey works.

# Phase 4 — Deployment and CI/CD (Day 13–15)

Goal: Make the application publicly accessible

## 8. Configure Vercel

* Import your GitHub repository into Vercel.

* Select Vite as the framework.

* Confirm build command: `npm run build`.

* Confirm output directory: `dist`.

* Configure environment variables.

* Deploy the application.

* Open the generated deployment URL.

* Verify the application loads correctly.

* Test frontend-to-Supabase communication.

## 9. Configure deployment workflow

* Connect the production branch to Vercel.

* Confirm that pushes to `main` trigger deployments.

* Create a test branch.

* Push a small change to the test branch.

* Verify that a preview deployment is created.

* Merge the test change into `main`.

* Verify that production updates automatically.

## 10. Set up GitHub Actions

* Create `.github/workflows/ci.yml`.

* Configure dependency installation.

* Configure linting.

* Configure automated tests.

* Configure production build verification.

* Open a pull request.

* Verify that the CI workflow runs successfully.

Deliverable: You can deploy by pushing code rather than manually uploading files.

# Phase 5 — Testing and stabilization (Day 16–20)

Goal: Make the application ready for testers

## 11. Test the application yourself

* Test the complete user journey.

* Test with a fresh account.

* Test with an existing account.

* Test incorrect form inputs.

* Test empty database states.

* Test slow network conditions.

* Test failed database requests.

* Test on desktop.

* Test on mobile.

* Check browser console for errors.

* Check Supabase logs for errors.

* Verify database access restrictions.

## 12. Prepare for external testing

* Decide whether testers need accounts.

* Create a simple onboarding flow.

* Prepare instructions for testers.

* Decide how they will report bugs.

* Remove development-only functionality.

* Ensure no secrets are exposed.

* Ensure no sensitive test data is accidentally public.

* Add a short privacy notice if collecting personal information.

Deliverable: You have a stable version that can be shared.

# Phase 6 — Friends and testers (Day 21–26)

Goal: Gather feedback and fix problems

## 13. Invite testers

* Invite a few friends.

* Share the Vercel URL.

* Explain what you want them to test.

* Ask them to use the application without your help.

* Observe where they get confused.

* Collect bugs and feedback.

* Prioritize critical bugs.

* Fix critical bugs.

* Deploy fixes through GitHub.

## 14. Final improvements

* Fix broken functionality.

* Fix important UI problems.

* Improve unclear error messages.

* Verify that data persists correctly.

* Verify that users cannot access each other's private data.

* Run a final production build.

* Verify the production deployment.

Deliverable: A tested application with the most important issues resolved.

# Phase 7 — Final backup and teardown (Day 27–30)

Goal: Preserve what matters and eliminate infrastructure costs

## 15. Back up your work

Before deleting anything:

* Push all final code to GitHub.

* Tag the final version in Git.

* Export your Supabase database.

* Download files from Supabase Storage.

* Save database migrations.

* Save `.env.example` without secrets.

* Document the deployment architecture.

* Store any required credentials securely.

* Verify that the backups are usable.

Example Git command:

Bash

```
git tag v1.0.0
git push origin v1.0.0
```

## 16. Delete your infrastructure

Follow this order:

1. Delete Vercel project

   * Open Vercel dashboard.

   * Select your project.

   * Open project settings.

   * Delete the project.

   * Verify it no longer appears.
2. Delete Supabase project

   * Open Supabase dashboard.

   * Select your project.

   * Navigate to project settings.

   * Delete the project.

   * Confirm deletion.
3. Clean up GitHub

   * Decide whether to preserve your repository.

   * Remove unnecessary secrets.

   * Disable any remaining workflows if preserving the repository.

   * Delete the repository only if you no longer need it.
4. Check billing

   * Check Vercel billing.

   * Check Supabase billing.

   * Check for any active subscriptions.

   * Check whether any paid add-ons were activated.

   * Verify that no billable resources remain.

My suggestion: Keep GitHub, but delete Vercel and Supabase. This allows you to retain your code and potentially redeploy the app later.

# Your 30-day calendar at a glance

## Development timeline

Day 1

Accounts and local setup

Days 2–3

Supabase and database

Days 4–12

Frontend and core features

Days 13–15

Deployment and CI/CD

Days 16–20

Testing and stabilization

Days 21–26

Friends and user feedback

Days 27–29

Final fixes and backups

Day 30

Infrastructure teardown

## A few rules I'd personally follow throughout the month

1. Commit every day. Your GitHub repository is your source of truth.

2. Deploy early. Don't wait until the application is finished before deploying.

3. Don't overengineer. You have a one-month lifespan; avoid infrastructure you don't need.

4. Use migrations. Don't rely exclusively on manually changing your production database.

5. Keep production and development separate where practical. At minimum, be careful when testing destructive database operations.

6. Monitor usage occasionally. Stay within free-tier limits.

7. Back up before teardown. Deleting your Supabase project means deleting its hosted database.

8. Set a reminder for Day 27. This gives you time to export data and delete everything before the month ends.

Final target: By Day 15, you should have a working deployed application. By Day 20, it should be stable enough for testers. By Day 30, your code and backups should be preserved, while the hosting infrastructure is deleted.
