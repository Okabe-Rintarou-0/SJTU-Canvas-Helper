export function formatDate(inputDate: string): string {
    if (!inputDate) {
        return "";
    }
    const date = new Date(inputDate);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

export function sleep(time: number) {
    return new Promise((resolve) => setTimeout(resolve, time));
}