
import { z } from 'zod';

export const loginSchema = z.object({
	endpoint: z
		.string()
		.min(8, 'Required')
		.max(200)
		.regex(/^https?:\/\/\S+$/, 'Must start with http:// or https://'),
	accessKey: z
		.string()
		.min(3, 'Required')
		.max(128)
		.regex(/^\S+$/, 'No spaces allowed'),
	secretKey: z
		.string()
		.min(8, 'At least 8 characters')
		.max(128)
		.regex(/^\S+$/, 'No spaces allowed')
});