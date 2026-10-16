export const handleError = ({
	error,
	status,
	message
}: {
	error: unknown;
	status: number;
	message: string;
}) => {
	if (status !== 404) console.error(error);

	return {
		message: status === 404 ? 'Not found' : message
	};
};
