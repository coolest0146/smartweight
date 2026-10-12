import React, { useState } from 'react';
import { createUser } from '../services/database';
import bcrypt from "bcryptjs";
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import loginBackground from "../assets/loginBackground.jpeg";
export default function SignupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [useremail, setUseremail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setIsLoading(true);
    try {
      const hashedPassword = await bcrypt.hash(password, 10);
      await createUser(username.trim(), useremail.trim().toLowerCase(), hashedPassword,"VIEWER");
      navigate("/", { state: { message: "Your account has been created. You can now log in." } });
    } catch (err) {
      console.error(err);
      setError("Unable to create the account. This email address may already be registered.");
    } finally {
      setIsLoading(false);
    }
  };
  const handlesigin = () => {
    
    navigate("/");
  };
  return (
    <div style={{ backgroundImage: `url(${loginBackground})` }} className="min-h-screen  flex items-center justify-center p-4 md:p-6 font-sans">
      
      {/* Main Container Card with Purple Glow Ring */}
      <div className="relative  max-w min-h-120   rounded overflow-hidden border ">
        
        {/* LEFT SIDE: LOGIN FORM (Takes 5/12 spaces) */}
        <div className="md:col-span-5 flex flex-col justify-center p-8 lg:p-12 bg-white/90">
          <h2 className="text-3xl font-bold text-blue-900 mb-8 tracking-wide text-center md:text-left">
            SignUp
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative border-b border-slate-700 focus-within:border-blue-900 transition-colors duration-200">
              <label htmlFor="signup-name" className="sr-only">Full name</label>
              <input
                id="signup-name"
                type="text"
                required
                autoComplete="name"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Full name"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              {/* User Icon SVG */}
              <svg className="absolute right-1 bottom-3 w-4 h-4 text-blue-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>

            <div className="relative border-b border-blue-900 focus-within:border-blue-900 transition-colors duration-200">
              <label htmlFor="signup-email" className="sr-only">Email address</label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={useremail}
                onChange={(e) => setUseremail(e.target.value)}
                placeholder="Email address"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              <svg className="absolute right-1 bottom-3 w-4 h-4 text-blue-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>

            <div className="relative border-b border-blue-900 focus-within:border-blue-900 transition-colors duration-200">
              <label htmlFor="signup-password" className="sr-only">Password</label>
              <input
                id="signup-password"
                type={isPasswordVisible ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                aria-label={isPasswordVisible ? "Hide passwords" : "Show passwords"}
                className="absolute right-1 bottom-2 rounded p-1 text-blue-900 transition-colors hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <div className="relative border-b border-blue-900 focus-within:border-blue-900 transition-colors duration-200">
              <label htmlFor="signup-confirm-password" className="sr-only">Confirm password</label>
              <input
                id="signup-confirm-password"
                type={isPasswordVisible ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="w-full bg-transparent pt-2 pb-3 pr-8 text-sm text-blue-900 placeholder-blue-900 outline-none"
              />
              <button
                type="button"
                onClick={() => setIsPasswordVisible((visible) => !visible)}
                aria-label={isPasswordVisible ? "Hide passwords" : "Show passwords"}
                className="absolute right-1 bottom-2 rounded p-1 text-blue-900 transition-colors hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-900"
              >
                {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Login Action Button */}
            <button
              type="submit"
              disabled={isLoading}
            
              className="relative w-full py-2.5 rounded-full bg-linear-to-r from-blue-600 to-blue-900 hover:from-blue-900 hover:to-blue-800 active:scale-[0.99] transition-all duration-200 font-semibold text-sm text-white-900 shadow-md shadow-purple-950/40 disabled:opacity-50"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
              ) : (
                'SignUp'
              )}
            </button>
          </form>

          {error && <p role="alert" className="mt-4 text-xs text-center md:text-left text-red-400">{error}</p>}

          {/* Registration Helper Footer */}
          <p className="mt-8 text-xs text-center md:text-left text-blue-900">
            Already have an account?
            <button type="button" onClick={handlesigin} className="ml-1 text-blue-900 hover:text-blue-900 font-medium underline underline-offset-2">
              Login
            </button>
          </p>
        </div>

      </div>

    </div>
  );
}
