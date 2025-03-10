
import Link from "next/link";
import VideoCall from "./components/VideoCall"; 

export default function Home() {
    return (
        <div className="flex justify-center items-center min-h-screen">
            <Link href="/chat">
                <button className="text-xl">Join the chat</button>
            </Link>
        </div>
    );
}
