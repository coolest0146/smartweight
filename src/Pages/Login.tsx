import React, { useState,useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Login } from '../services/database';
import { Eye, EyeOff } from 'lucide-react';
import bcrypt from 'bcryptjs';
import loginBackground from "../assets/loginBackground.jpeg";
import { invoke } from "@tauri-apps/api/core";
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const registrationMessage = (location.state as { message?: string } | null)?.message;

   useEffect(() => {
    // This runs the millisecond the login page mounts onto the DOM
    async function dismissSplash() {
      try {
        // Safe Handoff: Tell Tauri to close the splash screen and show this login page
        await invoke("close_splashscreen");
      } catch (err) {
        console.error("Failed to close splash screen:", err);
      }
    }

    dismissSplash();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      
      const activeUser = await Login(email.trim().toLowerCase());
     
      if (activeUser && (await bcrypt.compare(password, activeUser.password_hash))) {
        localStorage.setItem("token", activeUser.id.toString());
        localStorage.setItem("currentUser", JSON.stringify({
          id: activeUser.id,
          fullName: activeUser.name,
          role: activeUser.role,
          email: activeUser.email,
        }));
        navigate("/dashboard");
      } else {
        setError("Invalid email address or password.");
      }
    } catch (err) {
      console.error(err);
      setError("A local hardware database error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlesignup = () => {
    navigate("/signup");
  };

  return (
   <div
  className="min-h-screen flex items-center justify-center p-4 md:p-6 font-sans bg-cover bg-center bg-no-repeat"
  style={{ backgroundImage: `url(${loginBackground})` }}
>
      {/* Main Container Card with Purple Glow Ring */}
      <div className="relative bg-white/90 w-full max-w-212.5 min-h-120 grid grid-cols-1 md:grid-cols-12 rounded-2xl overflow-hidden ">
        
        {/* LEFT SIDE: LOGIN FORM (Takes 5/12 spaces) */}
        <div className="md:col-span-5 flex flex-col justify-center p-8 lg:p-12  ">
          <h2 className="text-3xl font-bold text-blue-900 mb-8 tracking-wide text-center md:text-left">
            Login
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative border-b border-blue-900 focus-within:border-blue-900 transition-colors duration-200">
              <label htmlFor="login-email" className="sr-only">Email address</label>
              <input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              {/* User Icon SVG */}
              <svg className="absolute right-1 bottom-3 w-4 h-4 text-blue-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>

            <div className="relative border-b border-blue-900 focus-within:border-black transition-colors duration-200">
              <label htmlFor="login-password" className="sr-only">Password</label>
              <input
                id="login-password"
                type={isPasswordVisible ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                className="absolute right-1 bottom-2 rounded p-1 text-blue-900 transition-colors hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Login Action Button */}
            <button
              type="submit"
              disabled={isLoading}
            
              className="relative w-full py-2.5 rounded-full bg-linear-to-r from-blue-600 to-blue-900 hover:from-blue-500 hover:to-blue-700 active:scale-[0.99] transition-all duration-200 font-semibold text-sm text-white shadow-md shadow-purple-950/40 disabled:opacity-50"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-blue-900 rounded-full animate-spin mx-auto" />
              ) : (
                'Login'
              )}
            </button>
          </form>

          {/* Registration Helper Footer */}
          <p className="mt-8 text-xs text-center md:text-left text-blue-900">
            Don't have an account? 
            <button type="button" onClick={handlesignup} className="ml-1 font-mono text-blue-900 hover:text-blue-900 font-medium underline underline-offset-2">
              Sign up
            </button>
          </p>
          {error && <p role="alert" className="mt-4 text-xs text-center md:text-left text-blue-900">{error}</p>}
          {registrationMessage && <p role="status" className="mt-4 text-xs text-center md:text-left text-blue-900">{registrationMessage}</p>}
        </div>

        {/* RIGHT SIDE: GRADIENT BANNER PANEL (Takes 7/12 spaces) */}
        <div className=" md:col-span-7 relative flex flex-col justify-center items-center text-center p-12 overflow-hidden">
          
          {/* Banner Content Typography */}
          <div className="relative z-10 max-w-sm space-y-4">
            <h2 className="text-3xl text-left font-mono font-bold text-blue-900  uppercase tracking-wider">
              Flintech weighing
            </h2>

            <div>
              
              <div className=" flex flex-row gap-2 text-blue-900 ">
                 <span>
                   Address: 
                 </span>
                 <p>P.BOX 2233 , TEMEKE DAR ES SALAAM</p>
              </div>
              <div className=" flex flex-row gap-2 text-blue-900 ">
                 <span>
                   Email:
                 </span>
                 <p>info@flintechweighing.com</p>
              </div>
              <div className=" flex flex-row gap-2 text-blue-900">
                 <span>
                   Web:
                 </span>
                 <p>www.flintechweighing.com</p>
              </div>
              <div className=" flex flex-row gap-2 text-blue-900">
                 <span>
                   Phone:
                 </span>
                 <p>+255 679 816 342/+255 785 760 010</p>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
