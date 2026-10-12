import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SerialConnectionProvider } from "../context/SerialConnectionContext";
// import SplashPage from "../Pages/splashscreen";
import SlipEntryLayout from "../Pages/dashboard";
import Setting from "../Pages/setting";
import SignupPage from "../Pages/signup";
import LoginPage from "../Pages/Login";
import Reports  from "../Pages/report";
import OperatorPage from "../Pages/operatorPage";
// function AuthenticatedOnly({ children }: { children: React.ReactElement }) {
//     const token = localStorage.getItem("token");

//     if (!token) {
//         return <Navigate to="/login" replace />;
//     }

//     return children;
// }

export default function AppRouter() {

    return (

        <BrowserRouter>
        <SerialConnectionProvider>
            <Routes>

                <Route 
                    path="/"
                    element={<LoginPage/>}
                />
                <Route
                    path="/dashboard"
                    element={<SlipEntryLayout/>}
                />

                <Route
                    path="/setting"
                    element={<Setting/>}
                />

           
                <Route 
                path="/signup" 
                element={<SignupPage/>}
                />
                <Route 
                path="/reports" 
                element={<Reports/>}
                />
                <Route 
                    path="/operator" 
                    element={<OperatorPage/>}
                />
            </Routes>
        </SerialConnectionProvider>
        </BrowserRouter>
    );
}
