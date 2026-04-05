Add a new blog post from the given source markdown file:

$ARGUMENTS

## Steps

1. **Read the source file** provided in the arguments. This is a plain markdown article, possibly without frontmatter.

2. **Read 2-3 existing posts** from `content/posts/` to confirm the current frontmatter format (fields, date format, tag style). Match whatever conventions are in use.

3. **Extract or generate frontmatter fields** from the article content:
   - `title`: Use the H1 heading (`# ...`) from the article. Remove the `#` prefix. If no H1 exists, derive a title from the content. If YAML frontmatter already exists with a title, use that.
   - `date`: Use today's date in `YYYY-MM-DD` format.
   - `description`: Write a 1-2 sentence meta description (120-155 characters) capturing the article's main argument or thesis. Include the primary keyword naturally near the beginning. This appears in search engine results and social previews, so make it compelling, specific, and action-oriented — not generic. It should give the reader a clear reason to click.
   - `tags`: Select 3-5 relevant tags. **Strongly prefer reusing existing tags** — list all tags found across `content/posts/` and `content/tags/`, and only select from those. A new tag should be a last resort, used only when the article covers a topic genuinely absent from the existing taxonomy.

4. **Suggest alternative titles.** Before writing the file, use AskUserQuestion to present the title and 3 alternatives. The alternatives should be:
   - **Option 1**: The original title extracted from the article (or generated in step 3).
   - **Option 2**: An SEO-optimized title — front-load the primary keyword, keep it under 60 characters, and make it clear what the reader will learn.
   - **Option 3**: An engagement-optimized title — use a compelling hook, curiosity gap, or strong opinion to maximize clicks and shares.
   - **Option 4**: A title that balances both SEO and engagement — includes the target keyword while still being compelling and click-worthy.

5. **Create the post file** at `content/posts/{slug}.md` where `{slug}` is derived from the chosen title — lowercased, whitespace and special characters replaced with hyphens, and consecutive hyphens collapsed (e.g., "A Practical Guide to Terraform" → `a-practical-guide-to-terraform.md`). The file should contain:
   - The generated YAML frontmatter between `---` fences, using the title chosen in step 4
   - The full article body from the source file, with the H1 heading removed (since the title is now in frontmatter) and any existing frontmatter removed (since it has been regenerated)

6. **Report** what was created: the filename, title, description, and tags chosen.
