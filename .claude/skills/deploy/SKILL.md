# /deploy - Deploy Checklist

Before deploying, verify ALL of the following:

1. **Confirm target**: staging or prod? Use correct deploy alias/environment.
2. **Run all tests** and confirm passing.
3. **Check for required database migrations or indexes** — deploy them first.
4. **Verify environment variables** point to correct project (not prod keys on staging).
5. **Check service timeouts** are sufficient for long-running operations.
6. **Deploy** and verify health endpoint responds.
7. **Update DEPLOYMENTS.md** (or equivalent changelog) after successful deploy.

Never deploy to production unless user explicitly says production.
