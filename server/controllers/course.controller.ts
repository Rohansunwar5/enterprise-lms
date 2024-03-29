import { NextFunction, Request, Response } from "express";
import ejs from "ejs";
import { CatchAsyncError } from "../middleware/catchAsyncErrors";
import ErrorHandler from "../utils/ErrorHandler";
import cloudinary from "cloudinary";
import { createCourse } from "../services/course.service";
import CourseModel from "../models/course.model";
import { redis } from "../utils/redis";
import mongoose from "mongoose";
import path from "path";
import sendMail from "../utils/sendMail";

// upload course 
export const uploadCourse = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {
    
    const data = req.body;
    const thumbnail = data.thumbnail;
    if(thumbnail){
      const myCloud = await cloudinary.v2.uploader.upload(thumbnail, {
        folder: 'courses'
      });

      data.thumbnail = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url
      }
    }

    createCourse(data, res,next);


  } catch (error: any) {
    return next(new ErrorHandler(error.message, 500))
  }
})

// adit course 

export const editCourse = CatchAsyncError(async(req:Request,res:Response,next:NextFunction)=> {
  try {
    const data = req.body;
    const thumbnail = data.thumbnail;

    if(thumbnail){
      // delete previous one 
      await cloudinary.v2.uploader.destroy(thumbnail?.public_id);

      const myCloud = await cloudinary.v2.uploader.upload(thumbnail, {
        folder: 'courses',
      })

      data.thumbnail = {
        public_id: myCloud.public_id,
        url: myCloud.secure_url,
      };
    }

    const courseId = req.params.id; // taking the course id 

    const course = await CourseModel.findByIdAndUpdate(
      courseId, 
      {
        $set: data,
      },
      { new: true }
    );

    res.status(201).json({
      success: true,
      course,
    });

  } catch (error: any) {
    return next(new ErrorHandler(error.message, 500))
  }
})

// get single course  -- without purchasing
// everyone can access this root 
export const getSingleCourse = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {
// NOTE: So to handle the server req with multiple users we check if the cache memory exist in users device, if exist we simply send from the redis else we check from the mongodb
    let courseId = req.params.id;

    const isCacheExist = await redis.get(courseId);

    console.log('hitting redis');

    if(isCacheExist){
      const course = JSON.parse(isCacheExist);
      res.status(201).json({
        success: true,
        course,
      });
    }
    else {
      const course = await CourseModel.findById(req.params.id).select("-courseData.videoUrl -courseData.suggestion -courseData.questions -courseData.links"); // we are avoiding sending this data so that the users cant acces it throught the network tab
      console.log('hitting mongodb');
      
      // after getting the data we set the cache  to it 
      await redis.set(courseId, JSON.stringify(course));

      res.status(200).json({
        success: true,
        course,
      })

    }

  } catch (error:any) {
    return next(new ErrorHandler(error.message, 500))
  }
})

// get all courses -- without purchasing

export const getAllCourses = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {

    const isCacheExist = await redis.get("allCourses");
    
    if(isCacheExist){
      const courses = JSON.parse(isCacheExist);
      console.log('hitting redis');
      
      res.status(201).json({
        success: true,
        courses,
      })
    } else {
      const courses = await CourseModel.find().select("-courseData.videoUrl -courseData.suggestion -courseData.questions -courseData.links");
      
      console.log('hitting mongodb');
      

      await redis.set('allCourses', JSON.stringify(courses));

      res.status(201).json({
        success: true,
        courses,
      })
    }

  } catch (error:any) {
    return next(new ErrorHandler(error.message, 500))
  }
})


// getting course content  -- only for valid user 

export const getCourseByUser = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {
    const userCourseList = req.user?.courses;
    const courseId = req.params.id;

    const courseExists =  userCourseList?.find((course:any) => course._id.toString() === courseId);

    if(!courseExists){
      return next(new ErrorHandler("You are not eligible for this course ", 404));
    }

    const course = await CourseModel.findById(courseId);

    const content = course?.courseData;

    res.status(200).json({
      success: true,
      content,
    })

  } catch (error:any) {
    return next(new ErrorHandler(error.message, 500))
  }
})

// add question in course 

interface IAddQuestionData{
  question: string,
  courseId: string,
  contentId: string,
}

export const addQuestion = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {
    const {question, courseId, contentId} = req.body as IAddQuestionData;

    const course = await CourseModel.findById(courseId);

    if(!mongoose.Types.ObjectId.isValid(contentId)){
      return next(new ErrorHandler("Invalid content Id", 500))
    }

    const courseContent = course?.courseData?.find((item:any) => item._id.equals(contentId));

    if(!courseContent){
      return next(new ErrorHandler("Invalid content id",401));
    }

    //create a new question object 
    const newQuestion:any = {
      user: req.user,
      question,
      questionReplies: [],
    }

    // add this question to our course content
    courseContent.questions.push(newQuestion);

    // save the update course 
    await course?.save();

    res.status(200).json({
      success: true,
      course,
    })

  } catch (error:any) {
    return next(new ErrorHandler(error.message, 500))
  }
})

// add answer to question 
interface IAddAnswerData{
  answer: string;
  courseId: string;
  contentId: string;
  questionId: string;
}


export const addAnswer = CatchAsyncError(async (req: Request, res: Response, next: NextFunction) => {
  try {
      const { answer, courseId, contentId, questionId }: IAddAnswerData = req.body;

      const course = await CourseModel.findById(courseId);

      if (!mongoose.Types.ObjectId.isValid(contentId)) {
          return next(new ErrorHandler("Invalid content Id", 500));
      }

      const courseContent = course?.courseData?.find((item: any) => item._id.equals(contentId));

      if (!courseContent) {
          return next(new ErrorHandler("Invalid content id", 401));
      }

      const question = courseContent?.questions?.find((item: any) => item?._id.equals(questionId));

      if (!question) {
          return next(new ErrorHandler("Question not found", 401));
      }

      // Create a new answer object
      const newAnswer: any = {
          user: req.user?._id,  // Assuming req.user is the user object and you want to save only the user ID
          answer,
      };

      // Add this answer to our course content
      question.questionReplies.push(newAnswer);

      await course?.save();

      if (req.user?._id === question.user?._id) {
          // TODO: create a notification
      } else {
          const data = {
              name: question.user.name,
              title: courseContent.title,
              // TODO: add more info so that the user can view a clear reply mail
          };

          const html = await ejs.renderFile(path.join(__dirname, "../mails/question-reply.ejs"), data);

          try {
              await sendMail({
                  email: question.user.email,
                  subject: "Question Reply",
                  template: "question-reply.ejs",
                  data,
              });
          } catch (error: any) {
              return next(new ErrorHandler(error.message, 500));
          }
      }

      res.status(200).json({
          success: true,
          course,
      });

  } catch (error: any) {
      return next(new ErrorHandler(error.message, 500));
  }
});


// add review in course 

interface IReviewData {
  review: string;
  rating: string;
  userId: string;
}

export const addReview = CatchAsyncError(async(req:Request,res:Response,next:NextFunction) => {
  try {
    const userCourseList = req.user?.courses;

    const courseId = req.params.id;

    // validate if course id exists in user course list
    const courseExists = userCourseList?.find((course:any) => course._id.toString() == courseId.toString());

    if(!courseExists){
      return next(new ErrorHandler ("You are not eligible to review on this course", 401));
    }

    const course = await CourseModel.findById(courseId);

    const {review, rating} = req.body as IReviewData

    const reviewData:any = {
      user: req.user,
      comment: review,
      rating,
    }

    course?.reviews.push(reviewData);

    let avg = 0;

    course?.reviews.forEach((rev:any) => {
      avg += rev.rating;
    })

    if(course){
      course.ratings = avg / course.reviews.length;
    }

    await course?.save();

    const notification = {
      title: "New Review Recieved",
      message: `${req.user?.name} has left a review on ${course?.name}`
    }

    // TODO: create notification 

    res.status(200).json({
      success: true,
      course,
    })

  } catch (error: any) {
    return next(new ErrorHandler(error.message, 500));
}
})
