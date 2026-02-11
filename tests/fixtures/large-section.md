# API Reference

This section contains detailed API documentation that exceeds the maximum token limit for a single chunk.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

The `createUser` function accepts the following parameters and returns a Promise that resolves to a User object. It validates all input fields before creating the record in the database. If validation fails, it throws a ValidationError with details about which fields failed.

When calling this function, make sure to handle both the success and error cases. The function supports batch creation through the `createMany` variant, which accepts an array of user objects and returns an array of created users. Failed items are collected in the errors array of the response.

Authentication is handled through JWT tokens. Each request must include a valid token in the Authorization header. Tokens expire after 24 hours by default, but this can be configured through the `tokenExpiry` setting. Refresh tokens are supported and have a 30-day expiry.

The database layer uses connection pooling to manage database connections efficiently. The default pool size is 10 connections, but this can be adjusted based on your workload. Connection timeouts are set to 30 seconds by default. Failed connections are automatically retried up to 3 times before throwing a ConnectionError.

Rate limiting is applied at the API gateway level. The default rate limit is 100 requests per minute per API key. You can request a higher limit by contacting support. Rate limit headers are included in every response: X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset.

Error handling follows a consistent pattern across all endpoints. All errors include a machine-readable error code, a human-readable message, and an optional details object with additional context. The error codes are documented in the Error Codes section below.

Pagination is cursor-based for all list endpoints. The response includes a `nextCursor` field when there are more results. Pass this value as the `cursor` query parameter to fetch the next page. The default page size is 20 items, with a maximum of 100.

Webhooks can be configured to receive real-time notifications about events in your account. Each webhook endpoint must respond with a 2xx status code within 5 seconds. Failed deliveries are retried with exponential backoff up to 5 times. You can verify webhook signatures using the shared secret provided during setup.

The SDK provides convenience methods for all API endpoints. It handles authentication, retries, and error parsing automatically. The SDK is available for JavaScript, Python, Ruby, and Go. Each SDK follows the idioms and conventions of its respective language.

Caching is built into the SDK by default. GET requests are cached for 5 minutes using an in-memory LRU cache. You can disable caching by passing `cache: false` in the request options. Custom cache implementations can be provided through the `cacheAdapter` option.

File uploads are supported through multipart form data. The maximum file size is 50MB. Supported file types include images (PNG, JPG, GIF, WebP), documents (PDF, DOC, DOCX), and archives (ZIP, TAR.GZ). Files are stored in S3 and served through CloudFront.

The search API supports full-text search across all indexed fields. Search queries support boolean operators (AND, OR, NOT), phrase matching with quotes, and field-specific searches using the `field:value` syntax. Results are ranked by relevance using BM25 scoring.

Batch operations are available for most write endpoints. Batch requests can contain up to 1000 operations. Operations within a batch are executed atomically — either all succeed or all fail. The response includes the status of each individual operation.
