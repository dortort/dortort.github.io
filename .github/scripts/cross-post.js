const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const matter = require('gray-matter');
const zlib = require('zlib');

// Configuration
const DEVTO_API_KEY = process.env.DEVTO_API_KEY;
const HASHNODE_ACCESS_TOKEN = process.env.HASHNODE_ACCESS_TOKEN;
const HASHNODE_PUBLICATION_ID = process.env.HASHNODE_PUBLICATION_ID;
const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
const TWITTER_API_KEY_SECRET = process.env.TWITTER_API_KEY_SECRET;
const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
const TWITTER_ACCESS_TOKEN_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;
const BASE_URL = "http://dortort.com";

function getCanonicalUrl(filename) {
    // content/posts/my-post.md -> http://dortort.com/posts/my-post/
    const baseName = path.basename(filename, path.extname(filename));
    return `${BASE_URL}/posts/${baseName}/`;
}

function normalizeUrl(url) {
    if (!url) return "";
    try {
        // Remove protocol
        let u = url.replace(/^https?:\/\//, '');
        // Remove trailing slash
        if (u.endsWith('/')) u = u.slice(0, -1);
        // Remove www.
        u = u.replace(/^www\./, '');
        return u.toLowerCase();
    } catch (e) {
        return "";
    }
}

async function postToDevto(article, canonicalUrl, publishDate) {
    if (!DEVTO_API_KEY) {
        console.log("Skipping Dev.to: DEVTO_API_KEY not set");
        return;
    }

    const headers = {
        "api-key": DEVTO_API_KEY,
        "Content-Type": "application/json"
    };

    try {
        // Check if article exists
        const response = await axios.get("https://dev.to/api/articles/me/all?per_page=1000", { headers });
        const articles = response.data;
        
        let existing = articles.find(a => normalizeUrl(a.canonical_url) === normalizeUrl(canonicalUrl));
        if (!existing) {
            existing = articles.find(a => a.title === article.data.title);
        }

        // For Dev.to: tags must be alphanumeric (ASCII letters, numbers, and underscores only), and a maximum of 4 tags is allowed. We replace non-alphanumeric characters and trim the list accordingly.
        const cleanTags = (article.data.tags || []).slice(0, 4).map(t => t.replace(/[^a-zA-Z0-9]/g, '').toLowerCase());

        // Process content to replace Mermaid blocks with Kroki images for Dev.to
        let content = article.content;
        const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
        
        content = content.replace(mermaidRegex, (match, code) => {
            try {
                const data = Buffer.from(code.trim(), 'utf8');
                const compressed = zlib.deflateSync(data, { level: 9 });
                const encoded = compressed.toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_');
                return `![Mermaid Diagram](https://kroki.io/mermaid/png/${encoded})`;
            } catch (e) {
                console.error("Failed to encode mermaid diagram for Dev.to:", e);
                return match; // Fallback to original code block
            }
        });

        const payload = {
            article: {
                title: article.data.title,
                body_markdown: content,
                tags: cleanTags,
                canonical_url: canonicalUrl,
                published: true,
                description: article.data.description || ""
            }
        };

        // Dev.to only allows future or current dates for published_at
        if (publishDate) {
             const dateObj = new Date(publishDate);
             const now = new Date();
             // If date is in the future, we can schedule it.
             // If it's in the past, we omit it (defaults to now).
             if (dateObj > now) {
                  payload.article.published_at = publishDate;
             }
        }

        if (existing) {
            console.log(`Updating existing Dev.to article: ${existing.title}`);
            const updateResponse = await axios.put(`https://dev.to/api/articles/${existing.id}`, payload, { headers });
            if (updateResponse.status === 200) {
                console.log("Successfully updated on Dev.to");
            }
        } else {
            console.log(`Creating new Dev.to article: ${article.data.title}`);
            const createResponse = await axios.post("https://dev.to/api/articles", payload, { headers });
            if ([200, 201].includes(createResponse.status)) {
                console.log("Successfully published to Dev.to");
            }
        }
    } catch (error) {
        console.error(`Failed to process Dev.to: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

async function getHashnodeTagIds(tags, headers) {
    const tagIds = [];
    for (const tagName of tags) {
        // Hashnode slugs should be lowercase and use dashes for spaces/special chars
        const slug = tagName.toLowerCase().replace(/[^a-z0-9]/g, "-");
        const query = `
        query GetTag($slug: String!) {
            tag(slug: $slug) {
                id
            }
        }
        `;
        try {
            const response = await axios.post("https://gql.hashnode.com", {
                query,
                variables: { slug }
            }, { headers });
            
            if (response.data.data && response.data.data.tag) {
                tagIds.push({ id: response.data.data.tag.id });
            } else {
                console.log(`Tag not found on Hashnode: ${tagName}`);
            }
        } catch (error) {
            console.error(`Error fetching tag ${tagName}: ${error.message}`);
        }
    }
    return tagIds;
}

async function postToHashnode(article, canonicalUrl, publishDate) {
    if (!HASHNODE_ACCESS_TOKEN) {
        console.log("Skipping Hashnode: HASHNODE_ACCESS_TOKEN not set");
        return;
    }

    const headers = {
        "Authorization": HASHNODE_ACCESS_TOKEN,
        "Content-Type": "application/json"
    };

    let pubId = HASHNODE_PUBLICATION_ID;
    
    if (!pubId) {
        const query = `
        query {
            me {
                publications(first: 1) {
                    edges {
                        node {
                            id
                        }
                    }
                }
            }
        }
        `;
        try {
            const response = await axios.post("https://gql.hashnode.com", { query }, { headers });
            if (response.data.data && response.data.data.me.publications.edges.length > 0) {
                pubId = response.data.data.me.publications.edges[0].node.id;
            } else {
                console.error("Could not fetch Hashnode Publication ID");
                return;
            }
        } catch (error) {
            console.error(`Failed to fetch Hashnode user info: ${error.message}`);
            return;
        }
    }

    // Check for existing post
    console.log(`Checking for duplicates in Hashnode publication ${pubId}...`);
    console.log(`Target Canonical URL: ${canonicalUrl}`);
    console.log(`Target Title: ${article.data.title}`);

    let existingPostId = null;
    let hasNextPage = true;
    let afterCursor = null;

    while (hasNextPage) {
        const queryPosts = `
        query GetPosts($publicationId: ObjectId!, $after: String) {
            publication(id: $publicationId) {
                posts(first: 20, after: $after) {
                    edges {
                        node {
                            id
                            title
                            canonicalUrl
                        }
                    }
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                }
            }
        }
        `;
        
        try {
            const response = await axios.post("https://gql.hashnode.com", {
                query: queryPosts,
                variables: { 
                    publicationId: pubId,
                    after: afterCursor
                }
            }, { headers });
            
            if (response.data.errors) {
                 console.error(`Hashnode API Errors during duplicate check: ${JSON.stringify(response.data.errors)}`);
                 // If we can't check, it's safer to stop than to duplicate
                 return;
            }

            if (response.data.data && response.data.data.publication) {
                const postsData = response.data.data.publication.posts;
                const posts = postsData.edges;
                
                for (const p of posts) {
                    const node = p.node;
                    // Debug logging (verbose but necessary for troubleshooting)
                    // console.log(`Checking against: [${node.id}] "${node.title}" (${node.originalArticleURL})`);

                    if (normalizeUrl(node.canonicalUrl) === normalizeUrl(canonicalUrl) || 
                        node.title === article.data.title) {
                        console.log(`Found existing post: ${node.id}`);
                        existingPostId = node.id;
                        break;
                    }
                }

                if (existingPostId) break;

                hasNextPage = postsData.pageInfo.hasNextPage;
                afterCursor = postsData.pageInfo.endCursor;
            } else {
                console.log("No publication data returned from Hashnode.");
                break;
            }
        } catch (error) {
            console.error(`Error checking existing Hashnode posts: ${error.message}`);
            if (error.response && error.response.data) {
                console.error('Error details:', JSON.stringify(error.response.data, null, 2));
            }
            // Stop processing to avoid duplicates on error
            return;
        }
    }

    const tags = article.data.tags || [];
    const tagIds = await getHashnodeTagIds(tags, headers);

    const inputData = {
        title: article.data.title,
        contentMarkdown: article.content,
        originalArticleURL: canonicalUrl,
        tags: tagIds,
        publicationId: pubId,
        publishedAt: publishDate
    };

    let mutation;
    let variables;
    
    if (existingPostId) {
        console.log(`Updating existing Hashnode post: ${article.data.title}`);
        mutation = `
        mutation UpdatePost($input: UpdatePostInput!) {
            updatePost(input: $input) {
                post {
                    id
                    url
                }
            }
        }
        `;
        inputData.id = existingPostId;
        variables = { input: inputData };
    } else {
        console.log(`Creating new Hashnode post: ${article.data.title}`);
        mutation = `
        mutation PublishPost($input: PublishPostInput!) {
            publishPost(input: $input) {
                post {
                    id
                    url
                }
            }
        }
        `;
        variables = { input: inputData };
    }

    try {
        const response = await axios.post("https://gql.hashnode.com", {
            query: mutation,
            variables
        }, { headers });

        if (response.data.errors) {
            console.error(`Hashnode API Errors: ${JSON.stringify(response.data.errors)}`);
        } else {
            const data = response.data.data;
            const postData = data.publishPost || data.updatePost;
            if (postData && postData.post) {
                console.log(`Successfully processed Hashnode post: ${postData.post.url}`);
            } else {
                console.log(`Hashnode response missing post data: ${JSON.stringify(data)}`);
            }
        }
    } catch (error) {
        console.error(`Failed to process Hashnode post: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

function percentEncode(str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/\*/g, '%2A')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
}

function generateOAuthHeader(method, url, queryParams = {}) {
    const oauthParams = {
        oauth_consumer_key: TWITTER_API_KEY,
        oauth_nonce: crypto.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_token: TWITTER_ACCESS_TOKEN,
        oauth_version: '1.0'
    };

    // Build signature base string (JSON body is NOT included per OAuth 1.0a spec)
    // Query params must be included in the signature for GET requests
    const allParams = { ...oauthParams, ...queryParams };
    const sortedParams = Object.keys(allParams).sort()
        .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
        .join('&');
    const baseString = `${method}&${percentEncode(url)}&${percentEncode(sortedParams)}`;
    const signingKey = `${percentEncode(TWITTER_API_KEY_SECRET)}&${percentEncode(TWITTER_ACCESS_TOKEN_SECRET)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

    oauthParams.oauth_signature = signature;

    const header = Object.keys(oauthParams).sort()
        .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
        .join(', ');
    return `OAuth ${header}`;
}

let _twitterUserId = null;
async function getTwitterUserId() {
    if (_twitterUserId) return _twitterUserId;
    const url = 'https://api.twitter.com/2/users/me';
    const authHeader = generateOAuthHeader('GET', url);
    const response = await axios.get(url, {
        headers: { 'Authorization': authHeader }
    });
    _twitterUserId = response.data.data.id;
    return _twitterUserId;
}

let _cachedTweets = null;
async function fetchRecentTweets() {
    if (_cachedTweets !== null) return _cachedTweets;
    const userId = await getTwitterUserId();
    const baseUrl = `https://api.twitter.com/2/users/${userId}/tweets`;
    const queryParams = {
        max_results: '100',
        'tweet.fields': 'entities'
    };
    const authHeader = generateOAuthHeader('GET', baseUrl, queryParams);
    const response = await axios.get(baseUrl, {
        params: queryParams,
        headers: { 'Authorization': authHeader }
    });
    _cachedTweets = response.data.data || [];
    return _cachedTweets;
}

async function hasExistingTweet(canonicalUrl) {
    try {
        const tweets = await fetchRecentTweets();
        const normalizedCanonical = normalizeUrl(canonicalUrl);

        for (const tweet of tweets) {
            // Check expanded URLs in entities (real URLs behind t.co)
            const urls = (tweet.entities && tweet.entities.urls) || [];
            for (const urlEntity of urls) {
                if (normalizeUrl(urlEntity.expanded_url) === normalizedCanonical ||
                    normalizeUrl(urlEntity.unwound_url) === normalizedCanonical) {
                    return true;
                }
            }
        }
        return false;
    } catch (error) {
        console.error(`Failed to check existing tweets: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
        // Fail safe: if we can't check, don't post (same pattern as Hashnode)
        return true;
    }
}

async function postToTwitter(article, canonicalUrl) {
    if (!TWITTER_API_KEY || !TWITTER_API_KEY_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_TOKEN_SECRET) {
        console.log("Skipping Twitter: Twitter credentials not set");
        return;
    }

    // Insert a zero-width space before file extensions that match real TLDs,
    // preventing Twitter from auto-linking them (e.g. .md = Moldova, .io = BIOT, .sh = St Helena)
    const title = article.data.title.replace(/(\w)\.(md|io|sh|do|so|ai|rs|py|cc|to)\b/gi, '$1.\u200B$2');
    const tags = (article.data.tags || []).slice(0, 3);
    const hashtags = tags.map(t => `#${t.replace(/[^a-zA-Z0-9]/g, '')}`).join(' ');

    // Build tweet: title + URL + hashtags (if they fit within 280 chars)
    // URLs count as 23 chars on Twitter (t.co wrapping)
    let tweetText = `${title}\n\n${canonicalUrl}`;
    if (hashtags && (tweetText.length + 2 + hashtags.length) <= 280) {
        tweetText += `\n\n${hashtags}`;
    }

    if (tweetText.length > 280) {
        // Truncate title to fit
        const maxTitleLen = 280 - canonicalUrl.length - 5; // \n\n + ...
        tweetText = `${title.substring(0, maxTitleLen)}...\n\n${canonicalUrl}`;
    }

    const url = 'https://api.twitter.com/2/tweets';
    const authHeader = generateOAuthHeader('POST', url);

    try {
        console.log(`Posting tweet for: ${title}`);
        const response = await axios.post(url, { text: tweetText }, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 201) {
            console.log(`Successfully posted tweet: https://x.com/i/status/${response.data.data.id}`);
        }
    } catch (error) {
        console.error(`Failed to post to Twitter: ${error.message}`);
        if (error.response) {
            console.error(error.response.data);
        }
    }
}

async function main() {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.log("No files provided");
        return;
    }

    for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        if (!fs.existsSync(file)) {
            console.log(`File not found: ${file}`);
            continue;
        }

        console.log(`Processing ${file}...`);
        try {
            const fileContent = fs.readFileSync(file, 'utf8');
            const article = matter(fileContent);

            if (article.data.draft === true) {
                console.log(`Skipping draft: ${file}`);
                continue;
            }

            const canonicalUrl = getCanonicalUrl(file);
            const publishDate = article.data.date ? new Date(article.data.date).toISOString() : undefined;
            
            await postToDevto(article, canonicalUrl, publishDate);
            await postToHashnode(article, canonicalUrl, publishDate);

            // Check Twitter for existing tweets (API-based dedup, like Dev.to and Hashnode)
            const alreadyTweeted = await hasExistingTweet(canonicalUrl);
            if (alreadyTweeted) {
                console.log(`Skipping Twitter for already-tweeted article: ${canonicalUrl}`);
            } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
                // On manual dispatch all post files are passed, but fetchRecentTweets
                // only covers the last 100 tweets. Guard against bulk-tweeting old
                // posts by restricting to articles published within the last 14 days.
                const postDate = article.data.date ? new Date(article.data.date) : null;
                const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
                if (postDate && postDate >= cutoff) {
                    await postToTwitter(article, canonicalUrl);
                } else {
                    console.log(`Skipping Twitter on manual dispatch for older article: ${canonicalUrl}`);
                }
            } else {
                await postToTwitter(article, canonicalUrl);
            }

        } catch (error) {
            console.error(`Error processing ${file}: ${error.message}`);
        }
    }
}

main();

