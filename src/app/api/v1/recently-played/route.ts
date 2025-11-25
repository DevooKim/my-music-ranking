import { NextResponse } from "next/server";
import { spotifyRecentlyPlayedSchema } from "@/lib/validations/spotify";
import { processRecentlyPlayed } from "@/lib/services/recently-played";
import { ZodError } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/recently-played
 *
 * Receives Spotify recently played tracks data and processes it in the background.
 *
 * @param request - Request containing Spotify recently played data
 * @returns Immediate 202 Accepted response
 */
export async function POST(request: Request) {
	try {
		// Parse request body
		const body = await request.json();

		// Validate request body against Spotify schema
		const validatedData = spotifyRecentlyPlayedSchema.parse(body);

		// Generate a unique job ID for tracking
		const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

		// Process data in background (fire and forget)
		processRecentlyPlayed(validatedData)
			.then(() => {
				console.log(`[${jobId}] Processing completed`);
			})
			.catch((error) => {
				console.error(`[${jobId}] Background processing failed:`, error);
			});

		// Return immediate 202 Accepted response
		return NextResponse.json(
			{
				success: true,
				message: "Request accepted and processing in background",
				jobId,
				itemsReceived: validatedData.items.length,
			},
			{ status: 202 },
		);
	} catch (error) {
		// Handle validation errors
		if (error instanceof ZodError) {
			return NextResponse.json(
				{
					success: false,
					error: "Validation failed",
					details: error.issues,
				},
				{ status: 400 },
			);
		}

		// Handle JSON parsing errors
		if (error instanceof SyntaxError) {
			return NextResponse.json(
				{
					success: false,
					error: "Invalid JSON",
				},
				{ status: 400 },
			);
		}

		// Handle other errors
		console.error("Error accepting request:", error);
		return NextResponse.json(
			{
				success: false,
				error: "Internal server error",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 500 },
		);
	}
}

/**
 * GET /api/v1/recently-played
 *
 * Returns API information
 */
export async function GET() {
	return NextResponse.json({
		name: "Recently Played API",
		version: "1.0.0",
		description: "API endpoint for processing Spotify recently played tracks",
		methods: {
			POST: {
				description: "Submit recently played tracks data",
				contentType: "application/json",
				schema: "SpotifyRecentlyPlayed",
			},
		},
	});
}
